import { conjugate, rotate } from "../../math/quat";
import { dot, sub } from "../../math/vec";
import type { Vec3 } from "../../state/types";
import type { Ray } from "./gizmo-math";
import { snap } from "./gizmo-math";
import type { BoxModel } from "./model";

export interface BodyHit {
  /** Ray parameter of the entry point. */
  t: number;
  /** Where the ray enters the box (world, float64, file frame). */
  point: Vec3;
}

/**
 * Where a ray enters the box (the front face). The ray is taken into the box's own frame and cut by the three slabs.
 * A ray that starts inside the box (a perspective eye inside it) has no hit, so the camera still orbits; an orthographic ray
 * starts on an arbitrary plane, so `allowInside` still reports the entry point behind its origin.
 */
export function rayBoxHit(ray: Ray, box: BoxModel, allowInside = false): BodyHit | null {
  const inv = conjugate(box.quat);
  const o = rotate(inv, sub(ray.origin, box.center));
  const d = rotate(inv, ray.dir);
  let tmin = Number.NEGATIVE_INFINITY;
  let tmax = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 3; i++) {
    const h = box.dimensions[i] / 2;
    if (Math.abs(d[i]) < 1e-15) {
      if (Math.abs(o[i]) > h) return null;
      continue;
    }
    const a = (-h - o[i]) / d[i];
    const b = (h - o[i]) / d[i];
    tmin = Math.max(tmin, Math.min(a, b));
    tmax = Math.min(tmax, Math.max(a, b));
  }
  if (!(tmin <= tmax) || tmax < 0) return null;
  if (tmin < 0 && !allowInside) return null;
  return { t: tmin, point: [ray.origin[0] + ray.dir[0] * tmin, ray.origin[1] + ray.dir[1] * tmin, ray.origin[2] + ray.dir[2] * tmin] };
}

/**
 * The box after a body drag: it follows the pointer on the plane through the grab point perpendicular to the view direction
 * `look`, so the grab offset is kept and, in a face view, the depth never changes. Snap rounds the displacement on each
 * world axis. Orientation and size are untouched. A ray parallel to the plane leaves the box where it was.
 */
export function moveOnPlane(box0: BoxModel, grab: Vec3, ray: Ray, look: Vec3, snapOpt: { on: boolean; step: number }): BoxModel {
  const denom = dot(look, ray.dir);
  if (Math.abs(denom) < 1e-12) return box0;
  const t = dot(look, sub(grab, ray.origin)) / denom;
  const p: Vec3 = [ray.origin[0] + ray.dir[0] * t, ray.origin[1] + ray.dir[1] * t, ray.origin[2] + ray.dir[2] * t];
  let delta = sub(p, grab);
  if (snapOpt.on) delta = delta.map((v) => snap(v, snapOpt.step)) as Vec3;
  return { ...box0, center: [box0.center[0] + delta[0], box0.center[1] + delta[1], box0.center[2] + delta[2]] };
}
