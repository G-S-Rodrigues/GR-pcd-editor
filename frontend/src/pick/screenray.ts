import { add, normalize, scale } from "../math/vec";
import type { Ray } from "../tools/box/gizmo-math";
import { type Camera, FOV_DEG, eyePosition, halfHeight, lookDirection, rightVector, upVector } from "../view/camera";
import type { Viewport } from "./ray";

const TAN_HALF = Math.tan((FOV_DEG * Math.PI) / 360);

/** World-space (float64, file frame) ray through a pixel (y down) of the viewport. */
export function screenRay(cam: Camera, vp: Viewport, px: number, py: number): Ray {
  const aspect = vp.w / Math.max(1, vp.h);
  const nx = (px / vp.w) * 2 - 1;
  const ny = 1 - (py / vp.h) * 2;
  const look = lookDirection(cam);
  const right = rightVector(cam);
  const up = upVector(cam);
  const eye = eyePosition(cam);
  if (cam.ortho) {
    const hh = halfHeight(cam);
    const o = add(add(eye, scale(right, nx * hh * aspect)), scale(up, ny * hh));
    return { origin: o, dir: normalize(look) };
  }
  const d = add(add(look, scale(right, nx * TAN_HALF * aspect)), scale(up, ny * TAN_HALF));
  return { origin: eye, dir: normalize(d) };
}

/** XY where the ray crosses the plane z = `z`; null if the ray is parallel to it. */
export function intersectZPlane(r: Ray, z: number): [number, number] | null {
  if (Math.abs(r.dir[2]) < 1e-12) return null;
  const t = (z - r.origin[2]) / r.dir[2];
  return [r.origin[0] + t * r.dir[0], r.origin[1] + t * r.dir[1]];
}
