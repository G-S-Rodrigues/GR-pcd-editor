import { describe, expect, it } from "vitest";
import type { Bounds, Vec3 } from "../../state/types";
import { type Camera, FOV_DEG, defaultCamera, orbit } from "../../view/camera";
import { PRESET_ORDER, PRESETS, applyPreset } from "../../view/presets";
import { defaultBox } from "./model";
import { MIN_RECT_PX, displayedBounds, fitToView, narrowBox, rectAxis, rectDepth, rectToBox } from "./rect";
import { emptyFilter } from "../../inspector/filters";

const vp = { w: 800, h: 600 };
const bounds: Bounds = { min: [-1, 0, 0], max: [19, 19, 4] };
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const camFor = (name: (typeof PRESET_ORDER)[number]): Camera => ({ ...applyPreset(defaultCamera(), name), target: [5, 6, 7], distance: 10 });

/** Independent expectation: world position of a pixel from the preset's look/up vectors. */
function world(name: (typeof PRESET_ORDER)[number], x: number, y: number): Vec3 {
  const { look, up } = PRESETS[name];
  const right = cross(look as Vec3, up as Vec3);
  const hh = 10 * Math.tan((FOV_DEG * Math.PI) / 360);
  const nx = (x / vp.w) * 2 - 1;
  const ny = 1 - (y / vp.h) * 2;
  const t: Vec3 = [5, 6, 7];
  return [0, 1, 2].map((i) => t[i] + right[i] * nx * hh * (vp.w / vp.h) + up[i] * ny * hh) as Vec3;
}

describe("rectangle select in an orthographic preset view (7b-1)", () => {
  it("UI-122 each of the six presets maps the dragged rectangle to the in-plane extents; depth is the bounds along the view axis", () => {
    for (const name of PRESET_ORDER) {
      const cam = camFor(name);
      const axis = rectAxis(cam);
      expect(axis, name).toBe(Math.abs(PRESETS[name].look[0]) ? 0 : Math.abs(PRESETS[name].look[1]) ? 1 : 2);
      const depth = rectDepth(axis!, bounds, null)!;
      expect(depth).toEqual({ min: bounds.min[axis!], max: bounds.max[axis!] });
      const box = rectToBox(defaultBox([0, 0, 0]), cam, vp, { x: 100, y: 100 }, { x: 300, y: 250 }, depth)!;
      expect(box, name).not.toBeNull();
      const a = world(name, 100, 100);
      const b = world(name, 300, 250);
      for (let i = 0; i < 3; i++) {
        if (i === axis) {
          expect(box.center[i]).toBeCloseTo((depth.min + depth.max) / 2, 9);
          expect(box.dimensions[i]).toBeCloseTo(depth.max - depth.min, 9);
        } else {
          expect(box.center[i], `${name}[${i}]`).toBeCloseTo((a[i] + b[i]) / 2, 6);
          expect(box.dimensions[i], `${name}[${i}]`).toBeCloseTo(Math.abs(a[i] - b[i]), 6);
        }
      }
      expect(box.quat).toEqual([0, 0, 0, 1]);
      // dragging the other way gives the same box; mode is kept
      const rev = rectToBox({ ...defaultBox([0, 0, 0]), mode: "outside" }, cam, vp, { x: 300, y: 250 }, { x: 100, y: 100 }, depth)!;
      expect(rev.center).toEqual(box.center);
      expect(rev.dimensions).toEqual(box.dimensions);
      expect(rev.mode).toBe("outside");
    }
  });

  it("UI-122 perspective, a rotated ortho view and a rectangle under 4 px give null", () => {
    const depth = { min: 0, max: 1 };
    const top = camFor("top");
    expect(rectAxis({ ...top, ortho: false })).toBeNull();
    expect(rectAxis(orbit(top, 0.3, 0))).toBeNull(); // yawed about the view axis: screen axes are not world axes
    expect(rectAxis(orbit(top, 0, 0.2))).toBeNull();
    expect(rectToBox(defaultBox([0, 0, 0]), top, vp, { x: 10, y: 10 }, { x: 10 + MIN_RECT_PX - 1, y: 200 }, depth)).toBeNull();
    expect(rectToBox(defaultBox([0, 0, 0]), top, vp, { x: 10, y: 10 }, { x: 200, y: 10 + MIN_RECT_PX - 1 }, depth)).toBeNull();
    expect(rectToBox(defaultBox([0, 0, 0]), { ...top, ortho: false }, vp, { x: 10, y: 10 }, { x: 200, y: 200 }, depth)).toBeNull();
  });

  it("UI-123 depth comes from the active slice slab when it is on the view axis, else from the bounds", () => {
    const slab = { enabled: true, axis: "y" as const, centre: 12, thickness: 4 };
    expect(rectDepth(1, bounds, slab)).toEqual({ min: 10, max: 14 });
    expect(rectDepth(2, bounds, slab)).toEqual({ min: 0, max: 4 }); // slab on another axis
    expect(rectDepth(1, bounds, { ...slab, enabled: false })).toEqual({ min: 0, max: 19 });
    expect(rectDepth(1, null, null)).toBeNull();
  });
});

describe("fit helpers (7b-1)", () => {
  it("UI-124 fit to view covers the visible rectangle with the bounds depth; null when not aligned", () => {
    const cam = camFor("front"); // looks along +Y, x right, z up
    const depth = rectDepth(1, bounds, null)!;
    const box = fitToView(defaultBox([0, 0, 0]), cam, vp, depth)!;
    const a = world("front", 0, 0);
    const b = world("front", vp.w, vp.h);
    expect(box.center[0]).toBeCloseTo((a[0] + b[0]) / 2, 6);
    expect(box.dimensions[0]).toBeCloseTo(Math.abs(a[0] - b[0]), 6);
    expect(box.dimensions[2]).toBeCloseTo(Math.abs(a[2] - b[2]), 6);
    expect(box.center[1]).toBeCloseTo(9.5, 9);
    expect(box.dimensions[1]).toBeCloseTo(19, 9);
    expect(fitToView(defaultBox([0, 0, 0]), { ...cam, ortho: false }, vp, depth)).toBeNull();
  });

  it("UI-124 displayed bounds narrow the active bounds only on enabled filter axes", () => {
    const f = emptyFilter();
    expect(displayedBounds(bounds, f)).toEqual(bounds);
    f.z = { enabled: true, min: 0.5, max: 10 };
    f.x = { enabled: true, min: -5, max: 3 };
    expect(displayedBounds(bounds, f)).toEqual({ min: [-1, 0, 0.5], max: [3, 19, 4] });
  });
});

describe("Shift rectangle narrows the box (7c-3)", () => {
  it("UI-164 in each preset the new box is the old box intersected on the two screen axes; the depth axis keeps its extent", () => {
    for (const name of PRESET_ORDER) {
      const cam = camFor(name);
      const axis = rectAxis(cam)!;
      const first = rectToBox(defaultBox([0, 0, 0]), cam, vp, { x: 100, y: 100 }, { x: 500, y: 400 }, { min: -3, max: 8 })!;
      const box = narrowBox(first, cam, vp, { x: 300, y: 250 }, { x: 650, y: 550 })!;
      expect(box, name).not.toBeNull();
      const a = world(name, 300, 250);
      const b = world(name, 650, 550);
      const f0 = world(name, 100, 100);
      const f1 = world(name, 500, 400);
      for (let i = 0; i < 3; i++) {
        if (i === axis) {
          expect(box.center[i], `${name}[${i}] depth centre`).toBeCloseTo(first.center[i], 9);
          expect(box.dimensions[i], `${name}[${i}] depth size`).toBeCloseTo(11, 9);
        } else {
          const lo = Math.max(Math.min(a[i], b[i]), Math.min(f0[i], f1[i]));
          const hi = Math.min(Math.max(a[i], b[i]), Math.max(f0[i], f1[i]));
          expect(box.center[i], `${name}[${i}]`).toBeCloseTo((lo + hi) / 2, 6);
          expect(box.dimensions[i], `${name}[${i}]`).toBeCloseTo(hi - lo, 6);
        }
      }
      expect(box.mode).toBe(first.mode);
    }
  });

  it("UI-164 a rectangle that misses the box on a screen axis, a tiny one, or a non-aligned view gives null", () => {
    const cam = camFor("top");
    const first = rectToBox(defaultBox([0, 0, 0]), cam, vp, { x: 100, y: 100 }, { x: 300, y: 300 }, { min: 0, max: 4 })!;
    expect(narrowBox(first, cam, vp, { x: 500, y: 100 }, { x: 700, y: 300 })).toBeNull();
    expect(narrowBox(first, cam, vp, { x: 150, y: 150 }, { x: 152, y: 152 })).toBeNull();
    expect(narrowBox(first, { ...cam, ortho: false }, vp, { x: 150, y: 150 }, { x: 250, y: 250 })).toBeNull();
  });

  it("UI-164 a rectangle that covers the box leaves it unchanged", () => {
    const cam = camFor("front");
    const first = rectToBox(defaultBox([0, 0, 0]), cam, vp, { x: 200, y: 200 }, { x: 300, y: 300 }, { min: 0, max: 4 })!;
    const box = narrowBox(first, cam, vp, { x: 50, y: 50 }, { x: 700, y: 500 })!;
    expect(box.center).toEqual(first.center);
    expect(box.dimensions).toEqual(first.dimensions);
  });
});
