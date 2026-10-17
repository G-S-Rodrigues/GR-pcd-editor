import { describe, expect, it, vi } from "vitest";
import { project } from "../pick/ray";
import { createAppStore } from "../state/app";
import { sessionFixture } from "../testing/fixtures";
import type { Vec3 } from "../state/types";
import { boxHandles } from "../tools/box/handles";
import { defaultBox } from "../tools/box/model";
import { defaultCamera } from "../view/camera";
import { applyPreset } from "../view/presets";
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
});
