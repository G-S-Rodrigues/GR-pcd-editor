import { type Quat, IDENTITY, fromBasis, rotate } from "../../math/quat";
import type { Bounds, Vec3 } from "../../state/types";

export type BoxMode = "inside" | "outside";

/** Box in world (file-frame, float64) coordinates; orientation is stored as a quaternion (local -> world). */
export interface BoxModel {
  center: Vec3;
  dimensions: Vec3;
  quat: Quat;
  mode: BoxMode;
}

export interface BoxEdit {
  ok: boolean;
  box: BoxModel;
  error?: string;
}

export const MIN_EXTENT = 1e-6;
const DEG = Math.PI / 180;
const finite3 = (v: readonly number[]) => v.length === 3 && v.every(Number.isFinite);

export const defaultBox = (center: Vec3): BoxModel => ({
  center: [...center],
  dimensions: [1, 1, 1],
  quat: IDENTITY,
  mode: "inside",
});
export const resetBox = defaultBox;
/** A file just opened: start from a small cube at the pivot, never from the whole cloud (one click on Apply could delete it). */
export const boxForOpen = (_previous: BoxModel, pivot: Vec3): BoxModel => defaultBox(pivot);

const cs = (deg: number): [number, number] =>
  deg === 0 ? [1, 0] : [Math.cos(deg * DEG), Math.sin(deg * DEG)];

/** R = Rz(yaw) Ry(pitch) Rx(roll), rows; rpy = [roll, pitch, yaw] in degrees (same as the backend). */
export function rotationMatrix(rpyDeg: Vec3): number[][] {
  const [cr, sr] = cs(rpyDeg[0]);
  const [cp, sp] = cs(rpyDeg[1]);
  const [cy, sy] = cs(rpyDeg[2]);
  return [
    [cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr],
    [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr],
    [-sp, cp * sr, cp * cr],
  ];
}

export function rpyToQuat(rpyDeg: Vec3): Quat {
  const m = rotationMatrix(rpyDeg);
  const col = (j: number): Vec3 => [m[0][j], m[1][j], m[2][j]];
  return fromBasis(col(0), col(1), col(2));
}

/** Roll/pitch/yaw degrees; at pitch +-90 (gimbal lock) yaw is shown as 0 and roll carries the rotation. */
export function quatToRpy(q: Quat): Vec3 {
  return rawRpy(q).map((a) => (Math.abs(a) < 1e-12 ? 0 : a)) as Vec3;
}

function rawRpy(q: Quat): Vec3 {
  const x = rotate(q, [1, 0, 0]);
  const y = rotate(q, [0, 1, 0]);
  const z = rotate(q, [0, 0, 1]);
  const r20 = x[2];
  const r21 = y[2];
  const r22 = z[2];
  const pitch = Math.asin(Math.max(-1, Math.min(1, -r20)));
  if (Math.abs(r20) < 1 - 1e-12) {
    return [Math.atan2(r21, r22) / DEG, pitch / DEG, Math.atan2(x[1], x[0]) / DEG];
  }
  const sp = -r20 > 0 ? 1 : -1;
  const roll = Math.atan2(sp * y[0], y[1]);
  return [roll / DEG, sp * 90, 0];
}

export const numericView = (b: BoxModel) => ({
  center: b.center,
  dimensions: b.dimensions,
  rpyDeg: quatToRpy(b.quat),
});

const fail = (box: BoxModel, error: string): BoxEdit => ({ ok: false, box, error });

export function setCenter(b: BoxModel, c: Vec3): BoxEdit {
  if (!finite3(c)) return fail(b, "Centre must be three finite numbers");
  return { ok: true, box: { ...b, center: [...c] } };
}
export function setDimensions(b: BoxModel, d: Vec3): BoxEdit {
  if (!finite3(d) || d.some((v) => v <= 0)) return fail(b, "Dimensions must be finite and greater than 0");
  return { ok: true, box: { ...b, dimensions: [...d] } };
}
export function setRpy(b: BoxModel, rpy: Vec3): BoxEdit {
  if (!finite3(rpy)) return fail(b, "Rotation angles must be finite numbers");
  return { ok: true, box: { ...b, quat: rpyToQuat(rpy) } };
}
export const setMode = (b: BoxModel, mode: BoxMode): BoxModel => ({ ...b, mode });

export const isAligned = (b: BoxModel): boolean => quatToRpy(b.quat).every((a) => Math.abs(a) < 1e-9);

export function boxCorners(b: BoxModel): Vec3[] {
  const out: Vec3[] = [];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) {
        const r = rotate(b.quat, [(sx * b.dimensions[0]) / 2, (sy * b.dimensions[1]) / 2, (sz * b.dimensions[2]) / 2]);
        out.push([b.center[0] + r[0], b.center[1] + r[1], b.center[2] + r[2]]);
      }
  return out;
}

/** World axis-aligned extents of the 8 corners (read-only for rotated boxes). */
export function worldExtents(b: BoxModel): Bounds {
  const cs3 = boxCorners(b);
  const min = [0, 1, 2].map((i) => Math.min(...cs3.map((c) => c[i]))) as Vec3;
  const max = [0, 1, 2].map((i) => Math.max(...cs3.map((c) => c[i]))) as Vec3;
  return { min, max };
}

export function minMaxState(b: BoxModel): { enabled: boolean; min: Vec3; max: Vec3; reason?: string } {
  const ext = worldExtents(b);
  if (isAligned(b)) return { enabled: true, min: ext.min, max: ext.max };
  return {
    enabled: false,
    min: ext.min,
    max: ext.max,
    reason: "Min/max editing is only available for an unrotated box; these are the world extents of the rotated box",
  };
}

export function setMinMax(b: BoxModel, min: Vec3, max: Vec3): BoxEdit {
  if (!isAligned(b)) return fail(b, "Min/max editing is only available for an unrotated box");
  if (!finite3(min) || !finite3(max)) return fail(b, "Min and max must be finite numbers");
  if ([0, 1, 2].some((i) => max[i] <= min[i])) return fail(b, "Max must be greater than min on every axis");
  return {
    ok: true,
    box: {
      ...b,
      center: [0, 1, 2].map((i) => (min[i] + max[i]) / 2) as Vec3,
      dimensions: [0, 1, 2].map((i) => max[i] - min[i]) as Vec3,
    },
  };
}

export const resetRotation = (b: BoxModel): BoxModel => ({ ...b, quat: IDENTITY });

export function fitToBounds(b: BoxModel, bounds: Bounds): BoxModel {
  const center = [0, 1, 2].map((i) => (bounds.min[i] + bounds.max[i]) / 2) as Vec3;
  const dimensions = [0, 1, 2].map((i) => Math.max(bounds.max[i] - bounds.min[i], MIN_EXTENT)) as Vec3;
  return { ...b, center, dimensions, quat: IDENTITY };
}

export function toBoxTool(b: BoxModel) {
  return {
    type: "box" as const,
    center: [...b.center] as Vec3,
    dimensions: [...b.dimensions] as Vec3,
    rpy_deg: quatToRpy(b.quat),
    mode: b.mode,
  };
}
