import type { Vec3 } from "../state/types";
import { type BoxModel, worldExtents } from "../tools/box/model";
export const SLICE_COPY = "Slice view only changes what is drawn. Selection, display filters, counts and Select displayed ignore it.";

export type SliceAxis = "x" | "y" | "z";

/** A render-only slab: points with centre - thickness/2 <= coordinate <= centre + thickness/2 on `axis` stay drawn. */
export interface Slice {
  enabled: boolean;
  axis: SliceAxis;
  centre: number;
  thickness: number;
}

export const defaultSlice = (): Slice => ({ enabled: false, axis: "z", centre: 0, thickness: 1 });

export const MIN_THICKNESS = 1e-6;

export const AXIS_INDEX: Record<SliceAxis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };

export type SlicePlane = { normal: [number, number, number]; constant: number };

const unit = (i: 0 | 1 | 2, sign: 1 | -1): [number, number, number] => {
  const n: [number, number, number] = [0, 0, 0];
  n[i] = sign;
  return n;
};

/** Two clipping planes (three.js form: a point is kept when normal . p + constant >= 0) in origin-relative coordinates. */
export function slicePlanes(s: Slice, origin: Vec3): SlicePlane[] {
  if (!s.enabled) return [];
  const i = AXIS_INDEX[s.axis];
  const lo = s.centre - s.thickness / 2 - origin[i];
  const hi = s.centre + s.thickness / 2 - origin[i];
  return [
    { normal: unit(i, 1), constant: -lo },
    { normal: unit(i, -1), constant: hi },
  ];
}

/** True when a world point lies outside an enabled slab. */
export function isClipped(s: Slice, p: Vec3): boolean {
  if (!s.enabled) return false;
  const v = p[AXIS_INDEX[s.axis]];
  return v < s.centre - s.thickness / 2 || v > s.centre + s.thickness / 2;
}

/** The slab that covers the box along `axis` (world extents, so a rotated box is covered too). */
export function sliceFromBox(box: BoxModel, axis: SliceAxis, prev: Slice): Slice {
  const i = AXIS_INDEX[axis];
  const e = worldExtents(box);
  return { ...prev, enabled: true, axis, centre: (e.min[i] + e.max[i]) / 2, thickness: Math.max(e.max[i] - e.min[i], MIN_THICKNESS) };
}

export function sliceFromPick(axis: SliceAxis, value: number, thickness: number): Slice {
  return { enabled: true, axis, centre: value, thickness: Math.max(thickness, MIN_THICKNESS) };
}

/** Moves the slab by one thickness along its own axis; a slice that is off stays off. */
export function stepSlice(s: Slice, dir: 1 | -1): Slice {
  return s.enabled ? { ...s, centre: s.centre + dir * s.thickness } : s;
}
