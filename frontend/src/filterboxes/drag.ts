import { dot, normalize } from "../math/vec";
import { axisParam } from "../tools/box/gizmo-math";
import type { Ray } from "../tools/box/gizmo-math";
import type { Axis, Side } from "../inspector/filters";
import type { Bounds, Vec3 } from "../state/types";

const UNIT: Record<Axis, Vec3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const IDX: Record<Axis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };
/** Looking within about 5.7 degrees of the axis: the ray cannot pick a position along it. */
export const END_ON_DOT = 0.995;

/**
 * Coordinate on `axis` under a pointer ray: the closest approach of the ray to the axis line through `origin`
 * (the same as intersecting the ray with the plane that holds the axis and faces the ray). Null when end-on.
 */
export function rayValue(ray: Ray, origin: Vec3, axis: Axis): number | null {
  const a = UNIT[axis];
  if (Math.abs(dot(normalize(ray.dir), a)) > END_ON_DOT) return null;
  const t = axisParam(ray, origin, a);
  return t === null ? null : origin[IDX[axis]] + t;
}

export interface FilterDrag {
  axis: Axis;
  side: Side;
  start: number;
  origin: Vec3;
  /** Coordinate under the pointer when the drag began (the grab offset). */
  grab: number;
}

export function beginFilterDrag(a: { axis: Axis; side: Side; value: number; ray: Ray; origin: Vec3 }): FilterDrag | null {
  const grab = rayValue(a.ray, a.origin, a.axis);
  return grab === null ? null : { axis: a.axis, side: a.side, start: a.value, origin: a.origin, grab };
}

/** The side's new value for the pointer ray, or null when end-on; `other` is the opposite side's value. */
export function moveFilterDrag(d: FilterDrag, ray: Ray, b: Bounds, other: number, fine: boolean): number | null {
  const v = rayValue(ray, d.origin, d.axis);
  if (v === null) return null;
  const i = IDX[d.axis];
  const raw = d.start + (v - d.grab) * (fine ? 0.1 : 1);
  return d.side === "min" ? Math.min(Math.max(raw, b.min[i]), other) : Math.max(Math.min(raw, b.max[i]), other);
}

/** Esc: the value to restore. */
export const cancelFilterDrag = (d: FilterDrag): number => d.start;
