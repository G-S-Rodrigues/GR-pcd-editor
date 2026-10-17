import type { Vec3 } from "../state/types";

/**
 * Orientation of the protection slab, degrees. The slab normal is n = Ry(ry) Rx(rx) e_z (the same convention as
 * the backend), the slab coordinate is s = n . (p - (px, py, 0)); at level s is exactly z.
 */
export interface Tilt {
  rx: number;
  ry: number;
  pivot: [number, number];
}

export const MAX_TILT_DEG = 60;
export const levelTilt = (): Tilt => ({ rx: 0, ry: 0, pivot: [0, 0] });
export const isLevel = (t: Tilt): boolean => t.rx === 0 && t.ry === 0;

const RAD = Math.PI / 180;

export function normalOf(t: Tilt): Vec3 {
  if (isLevel(t)) return [0, 0, 1];
  const a = t.rx * RAD;
  const b = t.ry * RAD;
  return [Math.cos(a) * Math.sin(b), -Math.sin(a), Math.cos(a) * Math.cos(b)];
}

/** The slab coordinate of a point (file frame). Level: exactly p[2]. */
export function slabCoordinate(p: Vec3, t: Tilt): number {
  if (isLevel(t)) return p[2];
  const n = normalOf(t);
  return n[0] * (p[0] - t.pivot[0]) + n[1] * (p[1] - t.pivot[1]) + n[2] * p[2];
}

/** Z of the slab plane s = v over the column (x, y). Level: exactly v. */
export function slabZ(t: Tilt, v: number, x: number, y: number): number {
  if (isLevel(t)) return v;
  const n = normalOf(t);
  return (v - n[0] * (x - t.pivot[0]) - n[1] * (y - t.pivot[1])) / n[2];
}
