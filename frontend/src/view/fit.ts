import { length, sub } from "../math/vec";
import type { Bounds } from "../state/types";
import { FOV_DEG, type Camera } from "./camera";
import { boundsCentre } from "./pivot";

/** Frames the bounding sphere of `b`; zero-extent bounds get a unit radius. */
export function fitBounds(c: Camera, b: Bounds, aspect: number): Camera {
  let radius = length(sub(b.max, b.min)) / 2;
  if (!(radius > 1e-9)) radius = 1;
  const s = Math.sin((FOV_DEG * Math.PI) / 360) * Math.min(1, Math.max(aspect, 1e-3));
  return { ...c, target: boundsCentre(b), distance: Math.max(radius / s, 1e-6) };
}
