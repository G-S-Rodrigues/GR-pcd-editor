import { describe, expect, it } from "vitest";
import type { Vec3 } from "../../state/types";
import {
  type BoxModel,
  boxCorners,
  defaultBox,
  boxForOpen,
  boxValidity,
  fitToBounds,
  numericView,
  quatToRpy,
  resetBox,
  resetRotation,
  rotationMatrix,
  rpyToQuat,
  setCenter,
  setDimensions,
  setMinMax,
  setRpy,
  toBoxTool,
  worldExtents,
  minMaxState,
} from "./model";
import { rotate } from "../../math/quat";

const near = (a: ArrayLike<number>, b: ArrayLike<number>, tol = 1e-9) => {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) expect(Math.abs(a[i] - b[i])).toBeLessThanOrEqual(tol);
};

describe("box model", () => {
  it("UI-30 rpy matrix matches hand-computed rotations", () => {
    // R = Rz(yaw) Ry(pitch) Rx(roll); rows of the matrix
    near(rotationMatrix([90, 0, 0]).flat(), [1, 0, 0, 0, 0, -1, 0, 1, 0]);
    near(rotationMatrix([0, 90, 0]).flat(), [0, 0, 1, 0, 1, 0, -1, 0, 0]);
    near(rotationMatrix([0, 0, 90]).flat(), [0, -1, 0, 1, 0, 0, 0, 0, 1]);
    // roll 90 then yaw 90: Rz(90) * Rx(90)
    near(rotationMatrix([90, 0, 90]).flat(), [0, 0, 1, 1, 0, 0, 0, 1, 0]);
  });

  it("UI-30 quat <-> rpy round trip, deterministic at gimbal lock", () => {
    for (const rpy of [[10, 20, 30], [-170, 45, 120], [0, 0, 0], [33, -80, -10]] as Vec3[]) {
      near(quatToRpy(rpyToQuat(rpy)), rpy, 1e-7);
    }
    for (const rpy of [[30, 90, 40], [20, -90, 10]] as Vec3[]) {
      const q = rpyToQuat(rpy);
      const shown = quatToRpy(q);
      expect(shown[2]).toBe(0);
      expect(Math.abs(shown[1])).toBeCloseTo(90, 6);
      // the displayed angles describe the same orientation
      const back = rpyToQuat(shown);
      for (const v of [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Vec3[]) {
        near(rotate(back, v), rotate(q, v), 1e-7);
      }
    }
  });

  it("UI-31 numeric edits update the model; invalid input keeps the previous box", () => {
    const b = defaultBox([0, 0, 0]);
    const r = setCenter(b, [1, 2, 3]);
    expect(r.ok).toBe(true);
    expect(r.box.center).toEqual([1, 2, 3]);
    for (const bad of [[NaN, 0, 0], [Infinity, 0, 0]] as Vec3[]) {
      const e = setCenter(r.box, bad);
      expect(e.ok).toBe(false);
      expect(e.box).toBe(r.box);
      expect(e.error).toBeTruthy();
    }
    for (const bad of [[0, 1, 1], [-1, 1, 1], [NaN, 1, 1]] as Vec3[]) {
      const e = setDimensions(r.box, bad);
      expect(e.ok).toBe(false);
      expect(e.box).toBe(r.box);
    }
    expect(setRpy(r.box, [0, Infinity, 0]).ok).toBe(false);
    near(numericView(setRpy(r.box, [0, 0, 90]).box).rpyDeg, [0, 0, 90], 1e-7);
  });

  it("UI-32 min/max only for unrotated boxes; world extents always available", () => {
    const b = setDimensions(setCenter(defaultBox([0, 0, 0]), [10, 0, 0]).box, [2, 4, 6]).box;
    const s = minMaxState(b);
    expect(s.enabled).toBe(true);
    near(s.min, [9, -2, -3]);
    near(s.max, [11, 2, 3]);
    const edited = setMinMax(b, [0, 0, 0], [4, 4, 4]);
    expect(edited.ok).toBe(true);
    near(edited.box.center, [2, 2, 2]);
    near(edited.box.dimensions, [4, 4, 4]);
    const rotated = setRpy(b, [0, 0, 45]).box;
    const rs = minMaxState(rotated);
    expect(rs.enabled).toBe(false);
    expect(rs.reason).toMatch(/rotat/i);
    expect(setMinMax(rotated, [0, 0, 0], [1, 1, 1]).ok).toBe(false);
    // AABB of the rotated 2x4x6 box at (10,0,0), yaw 45
    const ext = worldExtents(rotated);
    const h = Math.SQRT1_2 * (1 + 2);
    near(ext.min, [10 - h, -h, -3]);
    near(ext.max, [10 + h, h, 3]);
  });

  it("UI-33 resets and fits", () => {
    const rot = setRpy(defaultBox([5, 5, 5]), [10, 20, 30]).box;
    near(numericView(resetRotation(rot)).rpyDeg, [0, 0, 0]);
    expect(resetRotation(rot).center).toEqual(rot.center);
    const reset = resetBox([1, 2, 3]);
    expect(reset.center).toEqual([1, 2, 3]);
    expect(reset.dimensions).toEqual([1, 1, 1]);
    const fit = fitToBounds(rot, { min: [0, 0, 0], max: [4, 6, 8] });
    near(fit.center, [2, 3, 4]);
    near(fit.dimensions, [4, 6, 8]);
    near(numericView(fit).rpyDeg, [0, 0, 0]);
    const flat = fitToBounds(rot, { min: [0, 0, 0], max: [4, 6, 0] });
    expect(flat.dimensions[2]).toBeGreaterThan(0);
  });

  it("UI-34 request carries the exact world centre at large origins", () => {
    const b = setCenter(defaultBox([0, 0, 0]), [1000000.123, -2000000.5, 3.25]).box;
    const body = toBoxTool({ ...b, mode: "outside" });
    expect(body).toEqual({
      type: "box",
      center: [1000000.123, -2000000.5, 3.25],
      dimensions: [1, 1, 1],
      rpy_deg: [0, 0, 0],
      mode: "outside",
    });
  });

  it("UI-35 handle edits and numeric edits give the same geometry (seeded)", () => {
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    let box: BoxModel = defaultBox([0, 0, 0]);
    for (let i = 0; i < 50; i++) {
      const rpy: Vec3 = [rnd() * 60 - 30, rnd() * 60 - 30, rnd() * 360 - 180];
      const c: Vec3 = [rnd() * 10, rnd() * 10, rnd() * 10];
      const d: Vec3 = [0.1 + rnd() * 5, 0.1 + rnd() * 5, 0.1 + rnd() * 5];
      // "handle" path: quaternion set directly
      const viaHandle: BoxModel = { ...box, center: c, dimensions: d, quat: rpyToQuat(rpy) };
      // numeric path: read the numeric view, then rebuild from it
      const v = numericView(viaHandle);
      let viaNumeric = setCenter(box, v.center).box;
      viaNumeric = setDimensions(viaNumeric, v.dimensions).box;
      viaNumeric = setRpy(viaNumeric, v.rpyDeg).box;
      const a = boxCorners(viaHandle).flat();
      const bb = boxCorners(viaNumeric).flat();
      near(a, bb, 1e-9);
      box = viaNumeric;
    }
  });
});

it("UI-105 a newly opened file starts the box as a 1 m cube at the pivot, not at the whole cloud (F-03)", () => {
  const prev = { ...defaultBox([0, 0, 0]), dimensions: [50, 50, 9] as [number, number, number], mode: "outside" as const };
  const b = boxForOpen(prev, [4, 5, 6]);
  expect(b.center).toEqual([4, 5, 6]);
  expect(b.dimensions).toEqual([1, 1, 1]);
  expect(b.mode).toBe("inside");
});

describe("box validity", () => {
  it("UI-111 a zero, negative or non-finite size gives a reason and a good box gives none", () => {
    const b = defaultBox([0, 0, 0]);
    expect(boxValidity(b)).toBeNull();
    expect(boxValidity({ ...b, dimensions: [1, 0, 1] })).toBe("Invalid: size must be greater than 0 on every axis");
    expect(boxValidity({ ...b, dimensions: [1, 1, -2] })).toBe("Invalid: size must be greater than 0 on every axis");
    expect(boxValidity({ ...b, dimensions: [1, Number.NaN, 1] })).toMatch(/^Invalid: size/);
  });
});
