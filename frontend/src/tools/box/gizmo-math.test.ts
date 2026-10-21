import { describe, expect, it } from "vitest";
import { rotate } from "../../math/quat";
import type { Vec3 } from "../../state/types";
import {
  HANDLE_STYLES,
  type Ray,
  advanceTurn,
  applyPrecision,
  axisParam,
  ringAngle,
  ringPlaneHit,
  resizeFace,
  rotateBox,
  rotationDelta,
  routePointerDown,
  snap,
  translateDelta,
} from "./gizmo-math";
import { defaultCamera } from "../../view/camera";
import { applyPreset } from "../../view/presets";
import { boxOverlaySpec } from "./overlay";
import { boxCorners, defaultBox, quatToRpy, rpyToQuat } from "./model";

const ray = (origin: Vec3, dir: Vec3): Ray => ({ origin, dir });
const close = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

describe("gizmo math", () => {
  it("UI-36 translate along an axis from mouse rays; parallel ray gives zero", () => {
    // axis = world X through origin; camera looks down -Z from z=10
    const a = ray([0, 0, 10], [0, 0, -1]);
    const b = ray([2.5, 0, 10], [0, 0, -1]);
    close(translateDelta(a, b, [0, 0, 0], [1, 0, 0]), 2.5);
    // box-local axis (yawed 90 deg): local X is world Y
    close(translateDelta(ray([0, 0, 10], [0, 0, -1]), ray([0, 3, 10], [0, 0, -1]), [0, 0, 0], [0, 1, 0]), 3);
    // ray parallel to the axis: no NaN, zero
    const par = ray([0, 5, 0], [1, 0, 0]);
    expect(axisParam(par, [0, 0, 0], [1, 0, 0])).toBeNull();
    expect(translateDelta(par, par, [0, 0, 0], [1, 0, 0])).toBe(0);
    expect(translateDelta(a, par, [0, 0, 0], [1, 0, 0])).toBe(0);
  });

  it("UI-37 face resize keeps the opposite face fixed; symmetric keeps the centre; clamps", () => {
    const b = { ...defaultBox([0, 0, 0]), dimensions: [2, 2, 2] as Vec3, quat: rpyToQuat([0, 0, 90]) };
    const before = boxCorners(b);
    const r = resizeFace(b, 0, 1, 1, false); // +local X face by 1
    close(r.dimensions[0], 3);
    // local X is world Y here; the -X (local) face stays at world y = -1
    close(Math.min(...boxCorners(r).map((c) => c[1])), Math.min(...before.map((c) => c[1])));
    close(r.center[1], 0.5);
    const neg = resizeFace(b, 0, -1, 1, false);
    close(Math.max(...boxCorners(neg).map((c) => c[1])), Math.max(...before.map((c) => c[1])));
    const sym = resizeFace(b, 0, 1, 1, true);
    close(sym.dimensions[0], 4);
    expect(sym.center).toEqual(b.center);
    const clamp = resizeFace(b, 2, 1, -10, false);
    expect(clamp.dimensions[2]).toBeGreaterThan(0);
    close(clamp.dimensions[2], 1e-6);
    close(Math.min(...boxCorners(clamp).map((c) => c[2])), -1);
  });

  it("UI-38 rotation ring angle and rotation about the box centre", () => {
    const c: Vec3 = [1, 1, 0];
    const r0 = ray([2, 1, 5], [0, 0, -1]); // hits plane at +X of centre: angle 0
    const r1 = ray([1, 2, 5], [0, 0, -1]); // +Y of centre: 90 deg
    const a0 = ringAngle(r0, c, [0, 0, 1])!;
    const a1 = ringAngle(r1, c, [0, 0, 1])!;
    close(rotationDelta(a0, a1), Math.PI / 2);
    // wrap-around takes the short way
    close(rotationDelta(3.1, -3.1), 2 * Math.PI - 6.2);
    expect(ringAngle(ray([0, 0, 5], [1, 0, 0]), c, [0, 0, 1])).toBeNull();
    const b = { ...defaultBox([4, 5, 6]), dimensions: [2, 1, 1] as Vec3 };
    const rot = rotateBox(b, [0, 0, 1], Math.PI / 2);
    expect(rot.center).toEqual([4, 5, 6]);
    const x = rotate(rot.quat, [1, 0, 0]);
    close(x[0], 0);
    close(x[1], 1);
    close(quatToRpy(rot.quat)[2], 90, 1e-7);
  });

  it("UI-39 snapping and precision modifier", () => {
    close(snap(0.26, 0.1), 0.3);
    close(snap(-0.26, 0.1), -0.3);
    close(snap(47, 5), 45);
    expect(snap(1.234, 0)).toBe(1.234);
    close(applyPrecision(2, true), 0.2);
    expect(applyPrecision(2, false)).toBe(2);
  });

  it("UI-40 pointer routing and distinct handle styles", () => {
    expect(routePointerDown(true)).toBe("gizmo");
    expect(routePointerDown(false)).toBe("camera");
    const s = Object.values(HANDLE_STYLES);
    expect(new Set(s.map((x) => x.shape)).size).toBe(2);
    expect(HANDLE_STYLES.resize.shape).toBe("arrow");
    expect(HANDLE_STYLES.rotate.shape).toBe("ring");
    // per axis the arrow and its ring have different colours
    const spec = boxOverlaySpec(defaultBox([0, 0, 0]), applyPreset({ ...defaultCamera(), distance: 10 }, "top"), null, 720);
    for (const i of ["0", "1", "2"]) {
      const arrow = spec.arrows.find((x) => x.id === `resize-${i}+`)!;
      const ring = spec.rings.find((x) => x.id === `rotate-${i}+`)!;
      expect(arrow.colour).not.toBe(ring.colour);
    }
  });

  it("UI-900 ringAngle: a plane behind the eye holds in perspective, an ortho ray is a line", () => {
    const behind = ray([0, 0, -5], [0, 0, -1]); // the plane z = 0 lies behind the ray origin
    expect(ringAngle(behind, [0, 0, 0], [0, 0, 1])).toBeNull();
    expect(ringAngle(behind, [0, 0, 0], [0, 0, 1], false)).toBeNull();
    expect(typeof ringAngle(ray([1, 1, -5], [0, 0, -1]), [0, 0, 0], [0, 0, 1], true)).toBe("number");
    close(ringAngle(ray([1, 1, -5], [0, 0, -1]), [0, 0, 0], [0, 0, 1], true)!, ringAngle(ray([1, 1, 5], [0, 0, -1]), [0, 0, 0], [0, 0, 1])!);
    expect(ringPlaneHit(behind, [0, 0, 0], [0, 0, 1], false)).toBeNull();
    expect(ringPlaneHit(ray([0, 0, 5], [0, 0, -1]), [0, 0, 0], [0, 0, 1], false)!.t).toBeCloseTo(5, 12);
  });

  it("UI-899 advanceTurn accumulates past 180 degrees; null angles hold", () => {
    let st = { prev: 0, total: 0 };
    const step = (10 * Math.PI) / 180;
    for (let i = 1; i <= 27; i++) {
      let a = i * step;
      if (a > Math.PI) a -= 2 * Math.PI; // the raw angle wraps; the total must not
      st = advanceTurn(st, a);
    }
    close(st.total, (3 * Math.PI) / 2, 1e-12);
    const held = advanceTurn(st, null);
    expect(held).toEqual(st);
  });
});
