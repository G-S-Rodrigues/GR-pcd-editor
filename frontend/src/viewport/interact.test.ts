import { describe, expect, it, vi } from "vitest";
import { project } from "../pick/ray";
import { createAppStore } from "../state/app";
import { sessionFixture } from "../testing/fixtures";
import type { Vec3 } from "../state/types";
import { boxHandles } from "../tools/box/handles";
import { defaultBox } from "../tools/box/model";
import { defaultCamera } from "../view/camera";
import { applyPreset } from "../view/presets";
import { filterPlanes } from "../filterboxes/plane";
import { createToolInteraction } from "./interact";

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
  const arrow = boxHandles(box, camera, true).find((h) => h.cls === "translate" && h.axis === 0)!;
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

  it("UI-108 a Shift drag moves the box by a tenth of a plain drag", () => {
    const moved = (shift: boolean) => {
      const t = setup();
      t.tools.pointerDown(t.ev(t.at.x, t.at.y, shift));
      t.tools.pointerMove(t.ev(t.at.x + 100, t.at.y, shift));
      return t.store.get().tools.box.center[0];
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
