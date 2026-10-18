import { expect, test } from "vitest";
import { createAppStore } from "../state/app";
import { eyePosition, defaultCamera } from "../view/camera";
import { PRESET_ORDER, applyPreset } from "../view/presets";
import { patchDistanceVertex, distanceGlslRamp } from "../viewport/distanceShader";
import { layerColourKey } from "./key";
import { colourOptions, colourizeMasked } from "./modes";
import { RAMP_STOPS, rampLegend } from "./ramps";
import { PALETTE } from "./palette";
import { distanceRange, distanceT } from "./distance";

const BOUNDS = { min: [-1, 0, 0] as [number, number, number], max: [19, 19, 4] as [number, number, number] };
const centre = [9, 9.5, 2];
const radius = Math.hypot(20, 19, 4) / 2;

test("UI-370 distanceRange: near < far and the spread is at least the bounds radius for the six presets and an oblique camera", () => {
  const base = { ...defaultCamera(), target: centre as [number, number, number], distance: 30 };
  const cams = [...PRESET_ORDER.map((p) => applyPreset(base, p)), base];
  for (const cam of cams) {
    const { near, far } = distanceRange(eyePosition(cam), BOUNDS);
    expect(near).toBeLessThan(far);
    expect(far - near).toBeGreaterThanOrEqual(radius - 1e-9);
    expect(near).toBeGreaterThanOrEqual(0);
  }
  // an eye inside the cloud: near 0, far reaches the far side
  const inside = distanceRange(centre as [number, number, number], BOUNDS);
  expect(inside.near).toBe(0);
  expect(inside.far).toBeCloseTo(radius, 9);
  // a degenerate cloud (one point) still has a non-empty range
  const one = distanceRange([5, 5, 5], { min: [1, 1, 1], max: [1, 1, 1] });
  expect(one.far).toBeGreaterThan(one.near);
});

test("UI-371 distanceT clamps to 0..1 and is monotone; the distance ramp is the five approved stops, near light and far dark", () => {
  expect(distanceT(-5, 1, 3)).toBe(0);
  expect(distanceT(99, 1, 3)).toBe(1);
  expect(distanceT(2, 1, 3)).toBe(0.5);
  let prev = -1;
  for (let d = 0; d <= 10; d += 0.5) {
    const t = distanceT(d, 2, 8);
    expect(t).toBeGreaterThanOrEqual(prev);
    prev = t;
  }
  expect(RAMP_STOPS.distance).toHaveLength(5);
  const lum = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  expect(lum(RAMP_STOPS.distance[0])).toBeGreaterThan(lum(RAMP_STOPS.distance[4]));
  // the shader ramp is generated from the same table: every stop colour appears in the GLSL
  const glsl = distanceGlslRamp();
  for (const c of RAMP_STOPS.distance) expect(glsl).toContain(c[0].toFixed(5));
});

test("UI-372 the colour cache key of the distance mode changes with the mode but not with the camera", () => {
  const s = createAppStore();
  s.update((x) => ({ ...x, colour: { ...x.colour, mode: "distance" } }));
  const a = layerColourKey(s.get(), false);
  s.update((x) => ({ ...x, camera: { ...x.camera, distance: x.camera.distance * 3, target: [5, 5, 5] } }));
  s.update((x) => ({ ...x, camera: applyPreset(x.camera, "left") }));
  expect(layerColourKey(s.get(), false)).toBe(a);
  s.update((x) => ({ ...x, colour: { ...x.colour, mode: "turbo" } }));
  expect(layerColourKey(s.get(), false)).not.toBe(a);
});

test("UI-373 the ovr attribute is 1 for points whose baked colour is a flag, protected or region colour, 0 for the rest, one per point", () => {
  const coords = new Float32Array(3 * 7);
  coords[3 * 6 + 2] = 5; // point 6 sits in the protected region (z 5)
  const flags = new Uint8Array([0, 1, 2, 4, 8, 16, 0]);
  const r = { coords, flags, count: 7, origin: [0, 0, 0] as [number, number, number] };
  const ctx = {
    mode: "distance" as const,
    bounds: { min: [0, 0, 0] as [number, number, number], max: [0, 0, 10] as [number, number, number] },
    markDeleted: true,
    region: { intervals: [{ min: 4, max: 6 }] },
  };
  const { colours, ovr } = colourizeMasked(r, ctx);
  expect(ovr).toHaveLength(7);
  expect([...ovr]).toEqual([0, 1, 1, 1, 1, 1, 1]);
  expect([...colours.slice(3, 6)]).toEqual([...PALETTE.selected].map(Math.fround));
  // a deleted point is not an override when deleted points are not marked
  expect([...colourizeMasked(r, { ...ctx, markDeleted: false, region: null }).ovr]).toEqual([0, 1, 1, 0, 1, 1, 0]);
  // ramp modes use the same mask (the shader only reads it in distance mode)
  expect([...colourizeMasked(r, { ...ctx, mode: "turbo", markDeleted: false, region: null }).ovr]).toEqual([0, 1, 1, 0, 1, 1, 0]);
});

test("UI-374 the Distance option is enabled after Grey whatever the file holds, and its legend reads near to far", () => {
  const o = colourOptions([]);
  expect(o.map((x) => x.id)).toEqual(["turbo", "viridis", "flat", "distance"]);
  const d = o.find((x) => x.id === "distance");
  expect(d).toMatchObject({ enabled: true, label: "Distance to viewer" });
  expect(d?.attr).toBeUndefined();
  const l = rampLegend("distance", null, "m");
  expect(l?.minLabel).toBe("near");
  expect(l?.maxLabel).toBe("far");
  expect(l?.stops).toBe(RAMP_STOPS.distance);
});

test("UI-375 the shader patch inserts the distance colour after project_vertex, keeps the stock chunks and reads the flag mask", () => {
  const stock = "void main() {\n#include <color_vertex>\n#include <project_vertex>\n#include <clipping_planes_vertex>\n}";
  const out = patchDistanceVertex(stock);
  expect(out.indexOf("#include <project_vertex>")).toBeLessThan(out.indexOf("distRamp(t)"));
  expect(out.indexOf("distRamp(t)")).toBeLessThan(out.indexOf("#include <clipping_planes_vertex>"));
  expect(out).toContain("attribute float ovr");
  expect(out).toContain("uniform float uNear");
  expect(out).toContain("uMode");
  expect(out).toContain("length(mvPosition.xyz)");
  expect(out).toContain("ovr < 0.5");
  expect(() => patchDistanceVertex("void main() {}")).toThrow(/project_vertex/);
});
