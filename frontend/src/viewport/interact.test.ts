import { describe, expect, it, vi } from "vitest";
import { project } from "../pick/ray";
import { createAppStore } from "../state/app";
import { sessionFixture } from "../testing/fixtures";
import type { Vec3 } from "../state/types";
import { rayBoxHit } from "../tools/box/body";
import { boxHandles } from "../tools/box/handles";
import { defaultBox } from "../tools/box/model";
import { screenRay, intersectZPlane } from "../pick/screenray";
import { defaultCamera } from "../view/camera";
import { applyPreset } from "../view/presets";
import { filterPlanes } from "../filterboxes/plane";
import type { ProtectionModel } from "../inspector/protection";
import { tiltRings } from "../inspector/rings";
import { normalOf } from "../inspector/tilt";
import { createToolInteraction, planeAnchors } from "./interact";

const vp = { w: 800, h: 600 };
const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) } as unknown as HTMLCanvasElement;

function setup() {
  const store = createAppStore();
  const camera = applyPreset({ ...defaultCamera(), distance: 10 }, "top");
  const box = { ...defaultBox([0, 0, 0]), dimensions: [2, 2, 2] as Vec3 };
  store.set({ session: sessionFixture(), tool: "box", camera });
  store.update((s) => ({ ...s, tools: { ...s.tools, box } }));
  const changed = vi.fn();
  const tools = createToolInteraction(canvas, store, () => vp, { onToolChanged: changed, protectionEdit: (() => undefined) as never, notify: () => undefined });
  const arrow = boxHandles(box, camera, true).find((h) => h.id === "resize-0+")!;
  const at = project(camera, arrow.anchor, [0, 0, 0], vp)!;
  const ev = (x: number, y: number, shiftKey: boolean) => ({ button: 0, clientX: x, clientY: y, shiftKey, altKey: false }) as unknown as PointerEvent;
  return { store, tools, at, ev, changed };
}

describe("tool pointer routing (F-06)", () => {
  it("UI-107 Shift on a handle starts a fine drag (the handle wins over Shift-pan); Shift elsewhere falls through to pan", () => {
    const t = setup();
    expect(t.tools.pointerDown(t.ev(t.at.x, t.at.y, true))).toBe(true);
    expect(t.tools.dragging()).toBe(true);
    t.tools.pointerUp();
    expect(t.tools.pointerDown(t.ev(5, 5, true))).toBe(false); // empty space with Shift: the camera pans
    expect(t.tools.pointerDown(t.ev(5, 5, false))).toBe(false); // empty space: the camera orbits
    expect(t.tools.dragging()).toBe(false);
  });

  it("UI-108 a Shift drag resizes the box by a tenth of a plain drag", () => {
    const moved = (shift: boolean) => {
      const t = setup();
      t.tools.pointerDown(t.ev(t.at.x, t.at.y, shift));
      t.tools.pointerMove(t.ev(t.at.x + 100, t.at.y, shift));
      return t.store.get().tools.box.dimensions[0] - 2;
    };
    const plain = moved(false);
    expect(plain).toBeGreaterThan(0.1);
    expect(moved(true)).toBeCloseTo(plain * 0.1, 9);
  });
});

describe("rectangle select routing (7b-1)", () => {
  const rectSetup = (preset: "top" | "persp") => {
    const t = setup();
    const cam = preset === "top" ? t.store.get().camera : { ...t.store.get().camera, ortho: false };
    t.store.update((s) => ({ ...s, rect: true, camera: cam, session: sessionFixture({ active_bounds: { min: [-5, -5, 0], max: [5, 5, 3] } }) }));
    const notes: string[] = [];
    const tools = createToolInteraction(canvas, t.store, () => vp, { onToolChanged: t.changed, protectionEdit: (() => undefined) as never, notify: (m) => notes.push(m) });
    return { ...t, tools, notes };
  };

  it("UI-125 with Rect on, a drag in an aligned ortho view sets the box (live preview) and wins over a handle", () => {
    const t = rectSetup("top");
    expect(t.tools.pointerDown(t.ev(t.at.x, t.at.y, false))).toBe(true); // on a handle, but Rect is on
    t.tools.pointerMove(t.ev(t.at.x + 80, t.at.y + 60, false));
    const box = t.store.get().tools.box;
    expect(box.dimensions[0]).toBeGreaterThan(1);
    expect(box.dimensions[2]).toBe(3); // depth = active bounds along the view axis
    expect(box.center[2]).toBe(1.5);
    expect(t.changed).toHaveBeenCalled();
    t.tools.pointerUp();
  });

  it("UI-125 outside an aligned ortho view the drag is refused with the reason and falls through to orbit", () => {
    const t = rectSetup("persp");
    expect(t.tools.pointerDown(t.ev(100, 100, false))).toBe(false);
    expect(t.notes.join(" ")).toMatch(/ViewCube/);
  });

  it("UI-125 hold-R acts like the Rect toggle", () => {
    const t = setup();
    t.store.update((s) => ({ ...s, session: sessionFixture({ active_bounds: { min: [-5, -5, 0], max: [5, 5, 3] } }) }));
    const tools = createToolInteraction(canvas, t.store, () => vp, { onToolChanged: t.changed, protectionEdit: (() => undefined) as never, notify: () => undefined, rectHeld: () => true });
    expect(tools.pointerDown(t.ev(100, 100, false))).toBe(true);
  });

  it("UI-164 a Shift rectangle narrows the existing box and keeps its depth; a plain one replaces it", () => {
    const t = rectSetup("top");
    t.tools.pointerDown(t.ev(100, 100, false));
    t.tools.pointerMove(t.ev(500, 400, false));
    t.tools.pointerUp();
    const first = t.store.get().tools.box;
    t.store.update((s) => ({ ...s, tools: { ...s.tools, box: { ...first, center: [first.center[0], first.center[1], 9], dimensions: [first.dimensions[0], first.dimensions[1], 2] } } }));
    t.tools.pointerDown(t.ev(300, 250, true));
    t.tools.pointerMove(t.ev(700, 550, true));
    const narrowed = t.store.get().tools.box;
    expect(narrowed.dimensions[0]).toBeLessThan(first.dimensions[0]);
    expect(narrowed.center[2]).toBe(9); // depth kept, not reset to the bounds
    expect(narrowed.dimensions[2]).toBe(2);
    t.tools.pointerUp();
    t.tools.pointerDown(t.ev(300, 250, false));
    t.tools.pointerMove(t.ev(700, 550, false));
    expect(t.store.get().tools.box.dimensions[2]).toBe(3); // plain: depth reset to the bounds
  });
});


describe("filter arrow routing (part 10)", () => {
  const filterSetup = (over: { z?: { enabled: boolean; min: number; max: number }; collapsed?: boolean } = {}) => {
    const store = createAppStore();
    const camera = applyPreset({ ...defaultCamera(), distance: 30, target: [5, 5, 5] as Vec3 }, "front");
    store.set({ session: sessionFixture(), camera, tool: "box" });
    store.update((s) => ({
      ...s,
      tools: { ...s.tools, filters: { ...s.tools.filters, z: over.z ?? { enabled: true, min: 2, max: 8 } } },
      filterUi: { ...s.filterUi, collapsed: over.collapsed ? { "z-max": true } : ({} as Record<string, boolean>) },
    }));
    const edits: [string, string, number, boolean][] = [];
    const tools = createToolInteraction(canvas, store, () => vp, {
      onToolChanged: () => undefined,
      protectionEdit: (() => undefined) as never,
      notify: () => undefined,
      filterEdit: (axis, side, value, o) => {
        edits.push([axis, side, value, o.live]);
        return { ok: true } as never;
      },
    });
    const plane = filterPlanes(store.get(), vp.h).find((p) => p.key === "z-max");
    const tip = plane ? project(camera, plane.tip, [0, 0, 0], vp)! : null;
    const ev = (x: number, y: number) => ({ button: 0, clientX: x, clientY: y, shiftKey: false, altKey: false }) as unknown as PointerEvent;
    return { store, tools, tip, ev, edits };
  };

  it("UI-203 an arrow of a shown plane is grabbed first, even over box handles, and drags the side live then commits", () => {
    const t = filterSetup();
    expect(t.tip).not.toBeNull();
    expect(t.tools.pointerDown(t.ev(t.tip!.x, t.tip!.y))).toBe(true);
    expect(t.tools.dragging()).toBe(true);
    expect(t.store.get().filterUi.interacting).toBe("z-max");
    t.tools.pointerMove(t.ev(t.tip!.x, t.tip!.y - 30));
    const live = t.edits.at(-1)!;
    expect(live.slice(0, 2)).toEqual(["z", "max"]);
    expect(live[3]).toBe(true);
    expect(live[2]).toBeGreaterThan(8);
    t.tools.pointerUp();
    expect(t.edits.at(-1)![3]).toBe(false);
    expect(t.store.get().filterUi.interacting).toBeNull();
  });

  it("UI-203 with the plane hidden (collapsed or inactive) the same spot is not grabbed, so the camera orbits", () => {
    const shown = filterSetup();
    const spot = shown.tip!;
    for (const over of [{ collapsed: true }, { z: { enabled: false, min: 0, max: 10 } }]) {
      const t = filterSetup(over);
      expect(t.tools.pointerDown(t.ev(spot.x, spot.y))).toBe(false);
      expect(t.tools.dragging()).toBe(false);
      expect(t.edits).toEqual([]);
    }
  });

  it("UI-203 Esc cancels: the start value is restored with one committed edit", () => {
    const t = filterSetup();
    t.tools.pointerDown(t.ev(t.tip!.x, t.tip!.y));
    t.tools.pointerMove(t.ev(t.tip!.x, t.tip!.y - 30));
    t.tools.cancel();
    expect(t.edits.at(-1)).toEqual(["z", "max", 8, false]);
    expect(t.tools.dragging()).toBe(false);
    expect(t.store.get().filterUi.interacting).toBeNull();
    expect(t.tools.pointerUp()).toBe(false);
  });

  it("UI-203 an arrow drag in an end-on view is not started", () => {
    const t = filterSetup();
    t.store.update((s) => ({ ...s, camera: applyPreset(s.camera, "top") }));
    const top = filterPlanes(t.store.get(), vp.h).find((p) => p.key === "z-max")!;
    const at = project(t.store.get().camera, top.tip, [0, 0, 0], vp)!;
    expect(t.tools.pointerDown(t.ev(at.x, at.y))).toBe(false);
  });
});

describe("protection band routing (part 10)", () => {
  const protSetup = (view: "front" | "top" = "front") => {
    const store = createAppStore();
    const camera = applyPreset({ ...defaultCamera(), distance: 30, target: [5, 5, 5] as Vec3 }, view);
    store.set({ session: sessionFixture(), camera });
    store.update((s) => ({ ...s, tools: { ...s.tools, protection: { ...s.tools.protection, global: { enabled: true, min: 2, max: 4 } } } }));
    const edits: ProtectionModel[] = [];
    const tools = createToolInteraction(canvas, store, () => vp, {
      onToolChanged: () => undefined,
      notify: () => undefined,
      protectionEdit: (fn) => {
        const r = fn(store.get().tools.protection);
        if (r.ok) {
          store.update((s) => ({ ...s, tools: { ...s.tools, protection: r.model } }));
          edits.push(r.model);
        }
        return r;
      },
    });
    const at = (p: Vec3) => project(store.get().camera, p, [0, 0, 0], vp)!;
    const ev = (x: number, y: number) => ({ button: 0, clientX: x, clientY: y, shiftKey: false, altKey: false }) as unknown as PointerEvent;
    const anchors = () => planeAnchors(store.get(), vp.h);
    return { store, tools, at, ev, edits, anchors };
  };

  it("UI-210 an edge of the band is grabbed within 10 px of its outline and not 30 px away", () => {
    const t = protSetup();
    const onEdge = t.at([2, 5, 2]); // along the lower plane's outline, away from its arrow
    expect(t.tools.pointerDown(t.ev(onEdge.x, onEdge.y))).toBe(true);
    t.tools.pointerUp();
    const off = t.at([2, 5, 2]);
    expect(t.tools.pointerDown(t.ev(off.x, off.y + 30))).toBe(false);
  });

  it("UI-211 the upper plane's arrow points up, the lower one's down, and each drag moves only its own edge", () => {
    const t = protSetup();
    const [lo, hi] = [t.anchors().find((a) => a.key.edge === "min")!, t.anchors().find((a) => a.key.edge === "max")!];
    expect(hi.tip[2]).toBeGreaterThan(hi.anchor[2]);
    expect(lo.tip[2]).toBeLessThan(lo.anchor[2]);
    const tip = t.at(hi.tip);
    expect(t.tools.pointerDown(t.ev(tip.x, tip.y))).toBe(true);
    t.tools.pointerMove(t.ev(tip.x, tip.y - 40));
    t.tools.pointerUp();
    const g = t.store.get().tools.protection.global;
    expect(g.min).toBe(2);
    expect(g.max).toBeGreaterThan(4);
    const tip2 = t.at(t.anchors().find((a) => a.key.edge === "min")!.tip);
    t.tools.pointerDown(t.ev(tip2.x, tip2.y));
    t.tools.pointerMove(t.ev(tip2.x, tip2.y + 40));
    t.tools.pointerUp();
    const g2 = t.store.get().tools.protection.global;
    expect(g2.min).toBeLessThan(2);
    expect(g2.max).toBe(g.max);
  });

  it("UI-211 min never passes max, even dragged far beyond it", () => {
    const t = protSetup();
    const tip = t.at(t.anchors().find((a) => a.key.edge === "max")!.tip);
    t.tools.pointerDown(t.ev(tip.x, tip.y));
    t.tools.pointerMove(t.ev(tip.x, tip.y + 500));
    const g = t.store.get().tools.protection.global;
    expect(g.max).toBeGreaterThanOrEqual(g.min);
  });

  it("UI-211 Esc restores the start interval", () => {
    const t = protSetup();
    const tip = t.at(t.anchors().find((a) => a.key.edge === "max")!.tip);
    t.tools.pointerDown(t.ev(tip.x, tip.y));
    t.tools.pointerMove(t.ev(tip.x, tip.y - 40));
    expect(t.store.get().tools.protection.global.max).toBeGreaterThan(4);
    expect(t.tools.cancel()).toBe(true);
    expect(t.store.get().tools.protection.global).toEqual({ enabled: true, min: 2, max: 4 });
    expect(t.tools.dragging()).toBe(false);
  });

  it("UI-211 in the Top view the band is end-on and cannot be dragged", () => {
    const t = protSetup("top");
    const a = t.anchors().find((x) => x.key.edge === "max")!;
    const at = t.at(a.anchor);
    expect(t.tools.pointerDown(t.ev(at.x, at.y))).toBe(false);
    expect(t.edits).toEqual([]);
  });
});

describe("tilted protection band routing (10-6)", () => {
  const tiltSetup = (rx: number, ry: number) => {
    const store = createAppStore();
    const camera = applyPreset({ ...defaultCamera(), distance: 30, target: [5, 5, 5] as Vec3 }, "front");
    store.set({ session: sessionFixture(), camera });
    store.update((s) => ({
      ...s,
      tools: { ...s.tools, protection: { ...s.tools.protection, global: { enabled: true, min: 2, max: 4 }, tilt: { rx, ry, pivot: [5, 5] as [number, number] } } },
    }));
    const tools = createToolInteraction(canvas, store, () => vp, {
      onToolChanged: () => undefined,
      notify: () => undefined,
      protectionEdit: (fn) => {
        const r = fn(store.get().tools.protection);
        if (r.ok) store.update((s) => ({ ...s, tools: { ...s.tools, protection: r.model } }));
        return r;
      },
    });
    const at = (p: Vec3) => project(store.get().camera, p, [0, 0, 0], vp)!;
    const ev = (x: number, y: number) => ({ button: 0, clientX: x, clientY: y, shiftKey: false, altKey: false }) as unknown as PointerEvent;
    return { store, tools, at, ev };
  };

  it("UI-223 on a tilted slab each arrow points along the normal and the plane corners lie on the slab", () => {
    const t = tiltSetup(20, 0);
    const n = normalOf({ rx: 20, ry: 0, pivot: [5, 5] });
    const hi = planeAnchors(t.store.get(), vp.h).find((a) => a.key.edge === "max")!;
    const d = [hi.tip[0] - hi.anchor[0], hi.tip[1] - hi.anchor[1], hi.tip[2] - hi.anchor[2]];
    const len = Math.hypot(...d);
    for (let i = 0; i < 3; i++) expect(d[i] / len).toBeCloseTo(n[i], 9);
    for (const c of hi.corners) {
      expect(n[0] * (c[0] - 5) + n[1] * (c[1] - 5) + n[2] * c[2]).toBeCloseTo(4, 9);
    }
    // dragging the upper arrow up raises only the max
    const tip = t.at(hi.tip);
    expect(t.tools.pointerDown(t.ev(tip.x, tip.y))).toBe(true);
    t.tools.pointerMove(t.ev(tip.x, tip.y - 40));
    t.tools.pointerUp();
    const g = t.store.get().tools.protection.global;
    expect(g.min).toBe(2);
    expect(g.max).toBeGreaterThan(4);
  });

  it("UI-224 a ring drag tilts the slab live, Esc restores the start tilt, rings show only while the section is open", () => {
    const t = tiltSetup(0, 0);
    const ring = tiltRings(t.store.get(), vp.h).find((r) => r.id === "y")!;
    expect(ring.pts.length).toBeGreaterThan(8);
    const a = t.at(ring.pts[0]);
    const b = t.at(ring.pts[2]);
    expect(t.tools.pointerDown(t.ev(a.x, a.y))).toBe(true);
    t.tools.pointerMove(t.ev(b.x, b.y));
    const tilt = t.store.get().tools.protection.tilt;
    expect(Math.abs(tilt.ry)).toBeCloseTo((2 * 360) / ring.pts.length, 3);
    expect(tilt.rx).toBe(0);
    expect(t.tools.cancel()).toBe(true);
    expect(t.store.get().tools.protection.tilt.ry).toBe(0);
    expect(t.tools.dragging()).toBe(false);
    t.store.update((s) => ({ ...s, floorPanelOpen: false }));
    expect(tiltRings(t.store.get(), vp.h)).toEqual([]);
  });

  describe("box click-to-centre (13-6)", () => {
    const click = (t: ReturnType<typeof setup>, x: number, y: number, mod: Partial<PointerEvent> = {}) =>
      t.tools.click({ ...t.ev(x, y, false), ctrlKey: false, metaKey: false, ...mod } as PointerEvent);
    const plane = (t: ReturnType<typeof setup>, x: number, y: number) => {
      const s = t.store.get();
      return intersectZPlane(screenRay(s.camera, vp, x, y), s.tools.box.center[2])!;
    };

    it("UI-647 a click on empty space moves the centre to the ray's hit on the horizontal plane through the old centre, keeps size and Z", () => {
      const t = setup();
      t.store.update((s) => ({ ...s, tools: { ...s.tools, box: { ...s.tools.box, center: [0, 0, 2] } } }));
      const [ex, ey] = plane(t, 600, 200);
      expect(click(t, 600, 200)).toBe(true);
      const b = t.store.get().tools.box;
      expect(b.center[0]).toBeCloseTo(ex, 12);
      expect(b.center[1]).toBeCloseTo(ey, 12);
      expect(b.center[2]).toBe(2);
      expect(b.dimensions).toEqual([2, 2, 2]);
      expect(Math.abs(ex) + Math.abs(ey)).toBeGreaterThan(0.5); // it really moved
    });

    it("UI-648 the centre edit goes through onToolChanged once (live selection or preview follows)", () => {
      const t = setup();
      click(t, 600, 200);
      expect(t.changed).toHaveBeenCalledTimes(1);
    });

    it("UI-649 a click on a drawn cloud point centres on that point exactly, in world coordinates", () => {
      const t = setup();
      const origin: Vec3 = [1000, 2000, 3000];
      const local: Vec3 = [1.5, -0.5, 0.25];
      const world: Vec3 = [local[0] + origin[0], local[1] + origin[1], local[2] + origin[2]];
      const cam = { ...t.store.get().camera, target: [origin[0], origin[1], origin[2]] as Vec3 };
      t.store.set({ camera: cam, render: { coords: new Float32Array(local), count: 1, origin } as never });
      const at = project(cam, local, origin, vp)!;
      expect(click(t, at.x, at.y)).toBe(true);
      expect(t.store.get().tools.box.center).toEqual(world);
    });

    it("UI-650 a modified click (Shift, Ctrl, Alt, Meta) does not centre", () => {
      for (const mod of [{ shiftKey: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
        const t = setup();
        expect(click(t, 600, 200, mod)).toBe(false);
        expect(t.store.get().tools.box.center).toEqual([0, 0, 0]);
        expect(t.changed).not.toHaveBeenCalled();
      }
    });

    it("UI-651 no centring when another tool is armed, a pick mode is active, or the view is not the edited one", () => {
      for (const patch of [{ tool: "polygon" as const }, { tool: "none" as const }, { interaction: "pick-seed" as const }, { interaction: "pick-pivot" as const }, { compare: "original" as const }]) {
        const t = setup();
        t.store.set(patch);
        expect(click(t, 600, 200)).toBe(false);
        expect(t.store.get().tools.box.center).toEqual([0, 0, 0]);
      }
    });

    it("UI-652 a real press and release on empty space without movement reports a click; a handle press is not a click", () => {
      const t = setup();
      expect(t.tools.pointerDown(t.ev(5, 5, false))).toBe(false); // empty space: reaches the controls, which call click on release
      expect(t.tools.pointerDown(t.ev(t.at.x, t.at.y, false))).toBe(true); // handle: a drag, never a centring click
      t.tools.pointerUp();
      expect(t.store.get().tools.box.center).toEqual([0, 0, 0]);
    });
  });
});

describe("box gizmo routing (Part 14)", () => {
  type Mods = { shift?: boolean; ctrl?: boolean; meta?: boolean };
  const evm = (x: number, y: number, m: Mods = {}) =>
    ({ button: 0, clientX: x, clientY: y, shiftKey: !!m.shift, ctrlKey: !!m.ctrl, metaKey: !!m.meta, altKey: false }) as unknown as PointerEvent;
  const bodySetup = (dims: Vec3 = [2, 2, 2], persp = false) => {
    const store = createAppStore();
    const camera = persp ? { ...applyPreset({ ...defaultCamera(), distance: 10 }, "top"), ortho: false } : applyPreset({ ...defaultCamera(), distance: 10 }, "top");
    const box = { ...defaultBox([0, 0, 0]), dimensions: dims };
    store.set({ session: sessionFixture({ active_bounds: { min: [-5, -5, 0], max: [5, 5, 3] } }), tool: "box", camera });
    store.update((s) => ({ ...s, tools: { ...s.tools, box } }));
    const changed = vi.fn();
    const hints: string[] = [];
    const protEdits: ProtectionModel[] = [];
    const tools = createToolInteraction(canvas, store, () => vp, {
      onToolChanged: changed,
      protectionEdit: (fn) => {
        const r = fn(store.get().tools.protection);
        if (r.ok) {
          store.update((s) => ({ ...s, tools: { ...s.tools, protection: r.model } }));
          protEdits.push(r.model);
        }
        return r;
      },
      notify: () => undefined,
      hint: (m) => hints.push(m),
    });
    const at = (p: Vec3) => project(store.get().camera, p, [0, 0, 0], vp)!;
    const handle = (id: string) => {
      const h = boxHandles(store.get().tools.box, store.get().camera, true, vp.h, vp.w).find((x) => x.id === id)!;
      return { h, px: project(store.get().camera, h.anchor, [0, 0, 0], vp)! };
    };
    return { store, tools, at, changed, hints, protEdits, handle, box: () => store.get().tools.box };
  };

  it("UI-563 a body press moves the box, but only after rectangle, protection and the box arrows and rings declined it", () => {
    // plain body: the box moves with the pointer
    const t = bodySetup();
    const p = t.at([0.7, 0.7, 1]);
    expect(t.tools.pointerDown(evm(p.x, p.y))).toBe(true);
    const to = t.at([1.7, 0.7, 1]); // one unit to the right
    t.tools.pointerMove(evm(to.x, to.y));
    expect(t.box().center[0]).toBeCloseTo(1, 6);
    expect(t.box().dimensions).toEqual([2, 2, 2]);
    t.tools.pointerUp();
    // a ring over the body wins: the press rotates the box instead of moving it
    const big = bodySetup([8, 8, 2]);
    const ring = big.handle("rotate-2");
    const rp = project(big.store.get().camera, ring.h.ring![12], [0, 0, 0], vp)!;
    expect(big.tools.pointerDown(evm(rp.x, rp.y))).toBe(true);
    big.tools.pointerMove(evm(rp.x - 40, rp.y + 40));
    expect(big.box().center).toEqual([0, 0, 0]);
    expect(big.box().quat).not.toEqual(defaultBox([0, 0, 0]).quat);
    big.tools.pointerUp();
    // an arrow over the body wins: the press resizes
    const arrow = big.handle("resize-0+");
    expect(big.tools.pointerDown(evm(arrow.px.x, arrow.px.y))).toBe(true);
    big.tools.pointerMove(evm(arrow.px.x + 30, arrow.px.y));
    expect(big.box().dimensions[0]).toBeGreaterThan(8);
    big.tools.pointerUp();
    // Rect on: the rectangle drag replaces the box (depth = bounds), the body does not move it
    const r = bodySetup([8, 8, 2]);
    r.store.update((s) => ({ ...s, rect: true }));
    const q = r.at([0.7, 0.7, 1]);
    expect(r.tools.pointerDown(evm(q.x, q.y))).toBe(true);
    r.tools.pointerMove(evm(q.x + 80, q.y + 60));
    expect(r.box().dimensions[2]).toBe(3);
    r.tools.pointerUp();
    // a protection outline over the body wins
    const pr = bodySetup([8, 8, 2]);
    pr.store.set({ camera: applyPreset({ ...defaultCamera(), distance: 10 }, "front") });
    pr.store.update((s) => ({ ...s, tools: { ...s.tools, protection: { ...s.tools.protection, global: { enabled: true, min: -0.5, max: 0.5 } } } }));
    const anchor = planeAnchors(pr.store.get(), vp.h)[0];
    const ap = pr.at([2, 0, anchor.anchor[2]]); // on the band's outline, inside the body, clear of the rings
    expect(rayBoxHit(screenRay(pr.store.get().camera, vp, ap.x, ap.y), pr.box(), true)).not.toBeNull(); // it does overlap the body
    expect(pr.tools.pointerDown(evm(ap.x, ap.y))).toBe(true);
    pr.tools.pointerMove(evm(ap.x, ap.y - 30));
    expect(pr.protEdits.length).toBeGreaterThan(0);
    expect(pr.box().center).toEqual([0, 0, 0]);
  });

  it("UI-564 Shift or Ctrl (or Meta) on the body falls through to the camera; outside the box and in another tool nothing is taken", () => {
    const t = bodySetup();
    const p = t.at([0.7, 0.7, 1]);
    for (const m of [{ shift: true }, { ctrl: true }, { meta: true }]) {
      expect(t.tools.pointerDown(evm(p.x, p.y, m))).toBe(false);
      expect(t.tools.dragging()).toBe(false);
    }
    const out = t.at([3, 3, 0]);
    expect(t.tools.pointerDown(evm(out.x, out.y))).toBe(false);
    t.store.set({ tool: "polygon" });
    expect(t.tools.pointerDown(evm(p.x, p.y))).toBe(false);
    t.store.set({ tool: "box", interaction: "pick-pivot" });
    expect(t.tools.pointerDown(evm(p.x, p.y))).toBe(false); // a pick mode is not a box move
    t.store.set({ interaction: "orbit", compare: "original" });
    expect(t.tools.pointerDown(evm(p.x, p.y))).toBe(false); // only the edited view moves the box
  });

  it("UI-565 an unmoved body press (or one within 4 px) is a click: the box is untouched and the caller is told; a real drag is not a click", () => {
    const t = bodySetup();
    const p = t.at([0.7, 0.7, 1]);
    expect(t.tools.pointerDown(evm(p.x, p.y))).toBe(true);
    t.tools.pointerMove(evm(p.x + 3, p.y));
    expect(t.tools.pointerUp()).toBe(false);
    expect(t.tools.takeClick()).toBe(true);
    expect(t.tools.takeClick()).toBe(false); // once
    expect(t.box().center).toEqual([0, 0, 0]);
    expect(t.changed).not.toHaveBeenCalled();
    expect(t.tools.dragging()).toBe(false);
    t.tools.pointerDown(evm(p.x, p.y));
    t.tools.pointerMove(evm(p.x + 30, p.y));
    expect(t.tools.pointerUp()).toBe(true);
    expect(t.tools.takeClick()).toBe(false);
    expect(t.box().center[0]).toBeGreaterThan(0.4);
    // the click itself still centres a 3 m box where it landed (Part 13), through click()
    const c = bodySetup([3, 3, 3]);
    const cp = c.at([0.7, 0.7, 1]);
    c.tools.pointerDown(evm(cp.x, cp.y));
    c.tools.pointerUp();
    expect(c.tools.click(evm(cp.x, cp.y))).toBe(true);
    expect(c.box().center[0]).toBeCloseTo(0.7, 1);
  });

  it("UI-566 Esc during a body, arrow or ring drag restores the box from before the drag and stops the drag", () => {
    const t = bodySetup();
    expect(t.tools.cancel()).toBe(false); // nothing to cancel
    const start = t.box();
    const p = t.at([0.7, 0.7, 1]);
    t.tools.pointerDown(evm(p.x, p.y));
    t.tools.pointerMove(evm(p.x + 50, p.y + 20));
    expect(t.box().center).not.toEqual(start.center);
    expect(t.tools.cancel()).toBe(true);
    expect(t.box()).toEqual(start);
    expect(t.tools.dragging()).toBe(false);
    expect(t.tools.pointerUp()).toBe(false);
    expect(t.tools.takeClick()).toBe(false);
    for (const id of ["resize-1+", "rotate-2"]) {
      const h = t.handle(id);
      const q = id.startsWith("rotate") ? project(t.store.get().camera, h.h.ring![12], [0, 0, 0], vp)! : h.px;
      t.tools.pointerDown(evm(q.x, q.y));
      t.tools.pointerMove(evm(q.x + 40, q.y + 25));
      expect(t.box()).not.toEqual(start);
      expect(t.tools.cancel()).toBe(true);
      expect(t.box()).toEqual(start);
      expect(t.tools.dragging()).toBe(false);
    }
  });

  it("UI-567 hover names the cursor from the same hit tests: move over the body, a resize cursor over an arrow, grab over a ring, nothing elsewhere", () => {
    const t = bodySetup([8, 8, 2]);
    const body = t.at([2, 2, 1]);
    expect(t.tools.hover(evm(body.x, body.y))).toEqual({ cursor: "move", id: null });
    const ax = t.handle("resize-0+").px;
    expect(t.tools.hover(evm(ax.x, ax.y))).toEqual({ cursor: "ew-resize", id: "resize-0+" });
    const ay = t.handle("resize-1-").px;
    expect(t.tools.hover(evm(ay.x, ay.y))).toEqual({ cursor: "ns-resize", id: "resize-1-" });
    const rp = project(t.store.get().camera, t.handle("rotate-2").h.ring![12], [0, 0, 0], vp)!;
    expect(t.tools.hover(evm(rp.x, rp.y))).toEqual({ cursor: "grab", id: "rotate-2" });
    expect(t.tools.hover(evm(5, 5))).toBeNull();
    expect(t.tools.hover(evm(body.x, body.y, { shift: true }))).toBeNull(); // Shift pans there
    expect(t.tools.hover(evm(body.x, body.y, { ctrl: true }))).toBeNull(); // Ctrl orbits there
    t.store.update((s) => ({ ...s, rect: true }));
    expect(t.tools.hover(evm(body.x, body.y))).toBeNull();
    t.store.update((s) => ({ ...s, rect: false }));
    t.tools.pointerDown(evm(body.x, body.y));
    expect(t.tools.hover(evm(body.x, body.y))).toBeNull(); // not while a drag is under way
  });

  it("UI-568 the orbit hint shows once, on the first body drag that moves, never on a click or an arrow drag", () => {
    const t = bodySetup();
    const p = t.at([0.7, 0.7, 1]);
    t.tools.pointerDown(evm(p.x, p.y));
    t.tools.pointerUp();
    expect(t.hints).toEqual([]);
    const ax = t.handle("resize-0+").px;
    t.tools.pointerDown(evm(ax.x, ax.y));
    t.tools.pointerMove(evm(ax.x + 20, ax.y));
    t.tools.pointerUp();
    expect(t.hints).toEqual([]);
    for (let i = 0; i < 2; i++) {
      const q = t.at([0.6, 0.7, 1]);
      t.tools.pointerDown(evm(q.x, q.y));
      t.tools.pointerMove(evm(q.x + 20, q.y));
      t.tools.pointerUp();
    }
    expect(t.hints).toHaveLength(1);
    expect(t.hints[0]).toMatch(/Ctrl/);
  });
});
