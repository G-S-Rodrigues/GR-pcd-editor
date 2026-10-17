import { type Quat, fromAxisAngle, mul, normalizeQ, rotate } from "../math/quat";
import { add, scale } from "../math/vec";
import type { Vec3 } from "../state/types";
import { fromBasisLookUp } from "./basis";

export const FOV_DEG = 50;
const TAN_HALF = Math.tan((FOV_DEG * Math.PI) / 360);
export const MIN_DISTANCE = 1e-6;

/**
 * Orbit camera. `target` is in world (file-frame float64) coordinates; the
 * camera looks along its local -Z. In ortho mode the visible half height is
 * distance * tan(fov / 2), so switching projection keeps the apparent size.
 */
export interface Camera {
  target: Vec3;
  orientation: Quat;
  distance: number;
  ortho: boolean;
}

export const lookDirection = (c: Camera): Vec3 => rotate(c.orientation, [0, 0, -1]);
export const upVector = (c: Camera): Vec3 => rotate(c.orientation, [0, 1, 0]);
export const rightVector = (c: Camera): Vec3 => rotate(c.orientation, [1, 0, 0]);
export const halfHeight = (c: Camera): number => c.distance * TAN_HALF;

/** World position of the eye. */
export const eyePosition = (c: Camera): Vec3 =>
  add(c.target, scale(rotate(c.orientation, [0, 0, 1]), c.distance));

export function defaultCamera(): Camera {
  // isometric-ish: looking toward +Y, +X, downward
  const f: Vec3 = [-0.5, 0.7, -0.5];
  const n = Math.hypot(...f);
  return {
    target: [0, 0, 0],
    orientation: fromBasisLookUp(scale(f, 1 / n), [0, 0, 1]),
    distance: 10,
    ortho: false,
  };
}

/** Yaw about world Z (radians), pitch about the camera's right axis; pitch never passes a pole. */
export function orbit(c: Camera, yaw: number, pitch: number): Camera {
  let q = mul(fromAxisAngle([0, 0, 1], yaw), c.orientation);
  const f = rotate(q, [0, 0, -1]);
  const e = Math.asin(Math.max(-1, Math.min(1, f[2])));
  const e2 = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, e + pitch));
  const right = rotate(q, [1, 0, 0]);
  q = mul(fromAxisAngle(right, e2 - e), q);
  return { ...c, orientation: normalizeQ(q) };
}

/** Drag (dx, dy) screen pixels right/down moves the scene with the pointer. */
export function pan(c: Camera, dx: number, dy: number, viewportHeight: number): Camera {
  const perPx = (2 * halfHeight(c)) / Math.max(1, viewportHeight);
  const right = rightVector(c);
  const up = upVector(c);
  const move = add(scale(right, -dx * perPx), scale(up, dy * perPx));
  return { ...c, target: add(c.target, move) };
}

export function zoom(c: Camera, factor: number): Camera {
  return { ...c, distance: Math.max(MIN_DISTANCE, c.distance * factor) };
}

export function togglePerspective(c: Camera): Camera {
  return { ...c, ortho: !c.ortho };
}

