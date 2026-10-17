import { conjugate, rotate } from "../math/quat";
import { sub } from "../math/vec";
import type { Vec3 } from "../state/types";
import { type Camera, FOV_DEG, eyePosition, halfHeight } from "../view/camera";

export interface Viewport {
  w: number;
  h: number;
}
export interface PickCloud {
  coords: Float32Array; // origin-relative
  count: number;
  origin: Vec3;
}

const TAN_HALF = Math.tan((FOV_DEG * Math.PI) / 360);

/** Screen position (px, y down) and camera depth of an origin-relative point; null if behind a perspective eye. */
export function project(
  cam: Camera,
  local: Vec3,
  origin: Vec3,
  vp: Viewport,
): { x: number; y: number; depth: number } | null {
  const eyeLocal = sub(eyePosition(cam), origin);
  const p = rotate(conjugate(cam.orientation), sub(local, eyeLocal));
  const depth = -p[2];
  const aspect = vp.w / Math.max(1, vp.h);
  let nx: number;
  let ny: number;
  if (cam.ortho) {
    const hh = halfHeight(cam);
    nx = p[0] / (hh * aspect);
    ny = p[1] / hh;
  } else {
    if (depth <= 0) return null;
    nx = p[0] / (depth * TAN_HALF * aspect);
    ny = p[1] / (depth * TAN_HALF);
  }
  return { x: ((nx + 1) / 2) * vp.w, y: ((1 - ny) / 2) * vp.h, depth };
}

const TIE_PX = 1;

/** Nearest rendered point within `radiusPx` of the pixel; screen ties go to the point nearest the camera. */
export function pickPoint(
  cloud: PickCloud,
  cam: Camera,
  vp: Viewport,
  px: number,
  py: number,
  radiusPx = 8,
  accept?: (world: Vec3) => boolean,
): { index: number; depth: number; dist: number } | null {
  const hits: { index: number; depth: number; dist: number }[] = [];
  let best = Number.POSITIVE_INFINITY;
  const c = cloud.coords;
  for (let i = 0; i < cloud.count; i++) {
    const local: Vec3 = [c[3 * i], c[3 * i + 1], c[3 * i + 2]];
    if (accept && !accept([local[0] + cloud.origin[0], local[1] + cloud.origin[1], local[2] + cloud.origin[2]])) continue;
    const s = project(cam, local, cloud.origin, vp);
    if (!s) continue;
    const d = Math.hypot(s.x - px, s.y - py);
    if (d > radiusPx) continue;
    hits.push({ index: i, depth: s.depth, dist: d });
    if (d < best) best = d;
  }
  let out: { index: number; depth: number; dist: number } | null = null;
  for (const h of hits) {
    if (h.dist <= best + TIE_PX && (!out || h.depth < out.depth)) out = h;
  }
  return out;
}
