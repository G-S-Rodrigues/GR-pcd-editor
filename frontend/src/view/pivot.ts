import type { Bounds, Vec3 } from "../state/types";
import type { Camera } from "./camera";

export const boundsCentre = (b: Bounds): Vec3 => [
  (b.min[0] + b.max[0]) / 2,
  (b.min[1] + b.max[1]) / 2,
  (b.min[2] + b.max[2]) / 2,
];

export function resetPivot(c: Camera, activeBounds: Bounds | null): Camera {
  return activeBounds ? { ...c, target: boundsCentre(activeBounds) } : c;
}

/** Selection centre from the candidate bounds; null (control disabled) when there is none. */
export const selectionPivot = (b: Bounds | null): Vec3 | null => (b ? boundsCentre(b) : null);

export function pickPivot(
  c: Camera,
  hit: { id: number | null; point?: Vec3 | number[]; distance?: number },
): Camera {
  if (hit.id === null || !hit.point) return c;
  return { ...c, target: [hit.point[0], hit.point[1], hit.point[2]] };
}
