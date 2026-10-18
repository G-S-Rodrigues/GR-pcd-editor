import { expect, test } from "vitest";
import { rotate } from "../math/quat";
import type { Vec3 } from "../state/types";
import {
  FOV_DEG,
  defaultCamera,
  halfHeight,
  lookDirection,
  orbit,
  pan,
  togglePerspective,
  upVector,
  zoom,
} from "./camera";
import { fitBounds } from "./fit";
import { pickPivot, resetPivot, selectionPivot } from "./pivot";
import { PRESETS, applyPreset } from "./presets";

const close = (a: Vec3, b: Vec3, d = 9) => {
  for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i], d);
};

test("UI-09 six presets give the decided look direction and up, ortho, target kept", () => {
  const want: Record<string, [Vec3, Vec3]> = {
    top: [[0, 0, -1], [0, 1, 0]],
    bottom: [[0, 0, 1], [0, 1, 0]],
    front: [[0, 1, 0], [0, 0, 1]],
    back: [[0, -1, 0], [0, 0, 1]],
    left: [[1, 0, 0], [0, 0, 1]],
    right: [[-1, 0, 0], [0, 0, 1]],
  };
  expect(Object.keys(PRESETS).sort()).toEqual(Object.keys(want).sort());
  let cam = { ...defaultCamera(), target: [10.5, -2.25, 7] as Vec3, ortho: false };
  for (const name of Object.keys(want)) {
    cam = applyPreset(cam, name as keyof typeof PRESETS);
    close(lookDirection(cam), want[name][0]);
    close(upVector(cam), want[name][1]);
    expect(cam.ortho).toBe(true);
    expect(cam.target).toEqual([10.5, -2.25, 7]);
  }
});

test("UI-10 orbit yaws about world Z and clamps pitch; data untouched", () => {
  const data = new Float32Array([1, 2, 3, 4, 5, 6]);
  const before = data.slice();
  const ref = data;
  let cam = applyPreset(defaultCamera(), "front");
  const f0 = lookDirection(cam);
  cam = orbit(cam, Math.PI / 2, 0);
  const f1 = lookDirection(cam);
  expect(f1[2]).toBeCloseTo(f0[2], 9); // yaw keeps elevation
  expect(f1[0]).toBeCloseTo(-f0[1], 9); // 90 degrees about +Z: (0,1,0) -> (-1,0,0)
  cam = orbit(cam, 0, 10); // far past the pole
  expect(lookDirection(cam)[2]).toBeCloseTo(1, 9); // clamped at the pole, looking straight up
  expect(upVector(cam)[2]).toBeGreaterThanOrEqual(-1e-9);
  cam = orbit(cam, 0, -20);
  expect(lookDirection(cam)[2]).toBeCloseTo(-1, 9);
  expect(ref).toBe(data);
  expect([...data]).toEqual([...before]);
});

test("UI-10 pan moves the target in the screen plane; zoom scales distance and size", () => {
  let cam = applyPreset({ ...defaultCamera(), distance: 10 }, "top");
  const h0 = halfHeight(cam);
  const p = pan(cam, 100, 0, 500);
  // 100 px right at 500 px height: content moves right, so target moves left (-X)
  expect(p.target[0]).toBeCloseTo(-(100 * (2 * h0)) / 500, 9);
  expect(p.target[1]).toBeCloseTo(0, 9);
  expect(p.target[2]).toBeCloseTo(0, 9);
  const z = zoom(cam, 0.5);
  expect(z.distance).toBeCloseTo(5, 9);
  expect(halfHeight(z)).toBeCloseTo(h0 / 2, 9);
  expect(zoom(cam, 1e-30).distance).toBeGreaterThan(0);
});

test("UI-11 pivot reset, selection centre", () => {
  const cam = defaultCamera();
  expect(resetPivot(cam, { min: [0, 2, 4], max: [2, 4, 8] }).target).toEqual([1, 3, 6]);
  expect(resetPivot(cam, null)).toBe(cam);
  expect(selectionPivot(null)).toBeNull();
  expect(selectionPivot({ min: [-2, 0, 0], max: [0, 2, 2] })).toEqual([-1, 1, 1]);
});

test("UI-11 pick sets the target to the exact point from nearest", () => {
  const cam = defaultCamera();
  const exact: Vec3 = [1000000.123456789, -5, 2.5];
  expect(pickPivot(cam, { id: 4, point: exact, distance: 0.1 }).target).toEqual(exact);
  expect(pickPivot(cam, { id: null })).toBe(cam);
});

test("UI-12 fitBounds frames the box and survives degenerate bounds", () => {
  const cam = fitBounds(defaultCamera(), { min: [0, 0, 0], max: [10, 10, 10] }, 1.5);
  expect(cam.target).toEqual([5, 5, 5]);
  const r = Math.sqrt(75);
  expect(halfHeight(cam)).toBeGreaterThanOrEqual(r);
  const deg = fitBounds(defaultCamera(), { min: [3, 3, 3], max: [3, 3, 3] }, 1);
  expect(Number.isFinite(deg.distance) && deg.distance > 0).toBe(true);
  expect(deg.target).toEqual([3, 3, 3]);
});

test("UI-13 perspective toggle keeps target and apparent size", () => {
  const cam = { ...applyPreset(defaultCamera(), "top"), target: [1, 2, 3] as Vec3, distance: 40 };
  const p = togglePerspective(cam);
  expect(p.ortho).toBe(false);
  expect(p.target).toEqual([1, 2, 3]);
  expect(halfHeight(p)).toBeCloseTo(halfHeight(cam), 9);
  expect(halfHeight(cam)).toBeCloseTo(40 * Math.tan((FOV_DEG * Math.PI) / 360), 9);
  expect(togglePerspective(p).ortho).toBe(true);
});

test("quaternion rotate sanity", () => {
  const q = defaultCamera().orientation;
  const v = rotate(q, [1, 0, 0]);
  expect(Math.hypot(...v)).toBeCloseTo(1, 12);
});
