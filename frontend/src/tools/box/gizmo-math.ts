import { fromAxisAngle, mul, normalizeQ, rotate } from "../../math/quat";
import { dot, normalize, sub } from "../../math/vec";
import type { Vec3 } from "../../state/types";
import { type BoxModel, MIN_EXTENT } from "./model";

export interface Ray {
  origin: Vec3;
  dir: Vec3;
}

/** Parameter t of the point on the axis line (axisOrigin + t*axis) closest to the ray; null if parallel. */
export function axisParam(r: Ray, axisOrigin: Vec3, axis: Vec3): number | null {
  const u = normalize(axis);
  const v = normalize(r.dir);
  const w0 = sub(axisOrigin, r.origin);
  const b = dot(u, v);
  const denom = 1 - b * b;
  if (!(denom > 1e-12)) return null;
  return (b * dot(v, w0) - dot(u, w0)) / denom;
}

/** Distance moved along the axis between two mouse rays; 0 when either is parallel to the axis. */
export function translateDelta(from: Ray, to: Ray, axisOrigin: Vec3, axis: Vec3): number {
  const a = axisParam(from, axisOrigin, axis);
  const b = axisParam(to, axisOrigin, axis);
  return a === null || b === null ? 0 : b - a;
}

/**
 * Drag a face of the box along its local axis `axisIdx`; `sign` is +1 for the + face, -1 for the - face and
 * `d` the outward drag distance. The opposite face stays fixed unless `symmetric` (then the centre stays).
 */
export function resizeFace(b: BoxModel, axisIdx: 0 | 1 | 2, sign: 1 | -1, d: number, symmetric: boolean): BoxModel {
  const old = b.dimensions[axisIdx];
  const next = Math.max(old + (symmetric ? 2 * d : d), MIN_EXTENT);
  const change = next - old;
  const dimensions: Vec3 = [...b.dimensions];
  dimensions[axisIdx] = next;
  let center = b.center;
  if (!symmetric) {
    const local: Vec3 = [0, 0, 0];
    local[axisIdx] = (sign * change) / 2;
    const w = rotate(b.quat, local);
    center = [b.center[0] + w[0], b.center[1] + w[1], b.center[2] + w[2]];
  }
  return { ...b, dimensions, center };
}

/** Angle of the ray/plane intersection about `axis` through `center`; null if the ray is parallel to the plane. */
export function ringAngle(r: Ray, center: Vec3, axis: Vec3): number | null {
  const n = normalize(axis);
  const denom = dot(n, r.dir);
  if (Math.abs(denom) < 1e-12) return null;
  const t = dot(n, sub(center, r.origin)) / denom;
  const p: Vec3 = [r.origin[0] + t * r.dir[0], r.origin[1] + t * r.dir[1], r.origin[2] + t * r.dir[2]];
  const rel = sub(p, center);
  const helper: Vec3 = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = normalize(crossV(helper, n));
  const w = crossV(n, u);
  return Math.atan2(dot(rel, w), dot(rel, u));
}
const crossV = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Signed shortest delta between two angles. */
export function rotationDelta(a0: number, a1: number): number {
  let d = a1 - a0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

/** Rotates the box about its own centre around a world axis. */
export function rotateBox(b: BoxModel, worldAxis: Vec3, angle: number): BoxModel {
  return { ...b, quat: normalizeQ(mul(fromAxisAngle(worldAxis, angle), b.quat)) };
}

export const snap = (v: number, inc: number): number => (inc > 0 ? Math.round(v / inc) * inc : v);
export const applyPrecision = (delta: number, on: boolean): number => (on ? delta * 0.1 : delta);

export type HandleClass = "translate" | "resize" | "rotate";
export const HANDLE_STYLES: Record<HandleClass, { shape: "arrow" | "square" | "ring"; colour: string }> = {
  translate: { shape: "arrow", colour: "#ff5555" },
  resize: { shape: "square", colour: "#ffd23f" },
  rotate: { shape: "ring", colour: "#4cc9f0" },
};

/** A pointer-down that hits a handle drives the gizmo (camera orbit disabled for the drag); anything else the camera. */
export const routePointerDown = (hitHandle: boolean): "gizmo" | "camera" => (hitHandle ? "gizmo" : "camera");
