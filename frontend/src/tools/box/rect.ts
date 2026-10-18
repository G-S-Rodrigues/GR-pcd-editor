import { AXES, type FilterModel } from "../../inspector/filters";
import { IDENTITY } from "../../math/quat";
import type { Viewport } from "../../pick/ray";
import { screenRay } from "../../pick/screenray";
import type { Bounds, Vec3 } from "../../state/types";
import { type Camera, lookDirection, rightVector } from "../../view/camera";
import { MIN_EXTENT, type BoxModel, worldExtents } from "./model";

export const MIN_RECT_PX = 4;
export type Depth = { min: number; max: number };

const AXIS_TOL = 1e-6;
const axisOf = (v: Vec3): 0 | 1 | 2 | null => {
  for (const i of [0, 1, 2] as const) if (Math.abs(Math.abs(v[i]) - 1) < AXIS_TOL) return i;
  return null;
};

/**
 * World axis (0 x, 1 y, 2 z) the camera looks along, or null unless the view is orthographic and both the
 * look and the screen-right vectors are world axes (one of the six presets): only then is a screen rectangle
 * an axis-aligned world box.
 */
export function rectAxis(cam: Camera): 0 | 1 | 2 | null {
  if (!cam.ortho) return null;
  const look = axisOf(lookDirection(cam));
  const right = axisOf(rightVector(cam));
  return look !== null && right !== null && look !== right ? look : null;
}

/** Extent of the box along the view axis: the whole active-bounds extent. */
export function rectDepth(axis: 0 | 1 | 2, bounds: Bounds | null): Depth | null {
  return bounds ? { min: bounds.min[axis], max: bounds.max[axis] } : null;
}

/** Axis-aligned box from a dragged screen rectangle in a preset view; null when the view is not aligned or the rectangle is under 4 px. */
export function rectToBox(
  prev: BoxModel,
  cam: Camera,
  vp: Viewport,
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  depth: Depth,
): BoxModel | null {
  const axis = rectAxis(cam);
  if (axis === null) return null;
  if (Math.abs(p1.x - p0.x) < MIN_RECT_PX || Math.abs(p1.y - p0.y) < MIN_RECT_PX) return null;
  const a = screenRay(cam, vp, p0.x, p0.y).origin;
  const b = screenRay(cam, vp, p1.x, p1.y).origin;
  const center: Vec3 = [0, 0, 0];
  const dimensions: Vec3 = [0, 0, 0];
  for (const i of [0, 1, 2] as const) {
    const [lo, hi] = i === axis ? [depth.min, depth.max] : [Math.min(a[i], b[i]), Math.max(a[i], b[i])];
    center[i] = (lo + hi) / 2;
    dimensions[i] = Math.max(hi - lo, MIN_EXTENT);
  }
  return { ...prev, center, dimensions, quat: IDENTITY };
}

/**
 * Shift rectangle: the old box intersected with a dragged rectangle on the two screen axes; the depth axis keeps
 * the old box's extent (no reset to the cloud bounds). A rotated old box is narrowed from its world extents.
 * Null when the view is not aligned, the rectangle is under 4 px, or the rectangle misses the box.
 */
export function narrowBox(
  prev: BoxModel,
  cam: Camera,
  vp: Viewport,
  p0: { x: number; y: number },
  p1: { x: number; y: number },
): BoxModel | null {
  const axis = rectAxis(cam);
  if (axis === null) return null;
  if (Math.abs(p1.x - p0.x) < MIN_RECT_PX || Math.abs(p1.y - p0.y) < MIN_RECT_PX) return null;
  const a = screenRay(cam, vp, p0.x, p0.y).origin;
  const b = screenRay(cam, vp, p1.x, p1.y).origin;
  const old = worldExtents(prev);
  const center: Vec3 = [0, 0, 0];
  const dimensions: Vec3 = [0, 0, 0];
  const aligned = prev.quat.every((q, k) => q === IDENTITY[k]);
  for (const i of [0, 1, 2] as const) {
    if (i === axis && aligned) {
      // Untouched depth: keep the old values bit-exact (a lo/hi round trip can differ by one ulp).
      center[i] = prev.center[i];
      dimensions[i] = prev.dimensions[i];
      continue;
    }
    const lo = i === axis ? old.min[i] : Math.max(Math.min(a[i], b[i]), old.min[i]);
    const hi = i === axis ? old.max[i] : Math.min(Math.max(a[i], b[i]), old.max[i]);
    if (hi < lo) return null;
    center[i] = (lo + hi) / 2;
    dimensions[i] = Math.max(hi - lo, MIN_EXTENT);
  }
  return { ...prev, center, dimensions, quat: IDENTITY };
}

/** The box that covers the whole visible rectangle of an aligned ortho view (depth as for a drag). */
export function fitToView(prev: BoxModel, cam: Camera, vp: Viewport, depth: Depth): BoxModel | null {
  return rectToBox(prev, cam, vp, { x: 0, y: 0 }, { x: vp.w, y: vp.h }, depth);
}

/** Active bounds narrowed by the enabled display-filter axes. */
export function displayedBounds(active: Bounds, f: FilterModel): Bounds {
  const min = [...active.min] as Vec3;
  const max = [...active.max] as Vec3;
  AXES.forEach((axis, i) => {
    if (!f[axis].enabled) return;
    min[i] = Math.max(min[i], f[axis].min);
    max[i] = Math.min(max[i], f[axis].max);
    if (min[i] > max[i]) [min[i], max[i]] = [f[axis].min, f[axis].max];
  });
  return { min, max };
}
