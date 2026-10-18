import type { Bounds, Vec3 } from "../state/types";

/**
 * Eye distances that map to the two ends of the Distance ramp: the nearest and the farthest point of the active-bounds
 * sphere as seen from the eye. The range follows the camera but the colour cache key does not (the shader reads it
 * as a uniform), so moving the camera never recolours the cloud on the CPU.
 */
export function distanceRange(eye: Vec3, bounds: Bounds): { near: number; far: number } {
  const c = [0, 1, 2].map((k) => (bounds.min[k] + bounds.max[k]) / 2);
  const r = Math.max(Math.hypot(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]) / 2, 1e-6);
  const dc = Math.hypot(eye[0] - c[0], eye[1] - c[1], eye[2] - c[2]);
  return { near: Math.max(0, dc - r), far: dc + r };
}

/** Position of an eye distance on the ramp, 0 (near) to 1 (far), clamped. */
export function distanceT(d: number, near: number, far: number): number {
  return far > near ? Math.min(1, Math.max(0, (d - near) / (far - near))) : 0.5;
}
