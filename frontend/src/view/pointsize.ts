import { MAX_BUDGET } from "../render/parse";
import { type Camera, halfHeight } from "./camera";

/** The "Auto (max)" draw budget: the largest the backend serves. */
export const AUTO_BUDGET = MAX_BUDGET;

/** Point size in px for a view showing `pxPerUnit` pixels per world unit (about 0.1 unit spacing), clamped to the slider range. */
export function pointSizeFor(pxPerUnit: number): number {
  if (!Number.isFinite(pxPerUnit)) return 3;
  return Math.round(Math.min(10, Math.max(1, pxPerUnit * 0.1)) * 2) / 2;
}

/** Pixels per world unit at the camera target (same in perspective and orthographic). */
export const pxPerUnit = (cam: Camera, viewportHeight: number): number => viewportHeight / (2 * halfHeight(cam));
