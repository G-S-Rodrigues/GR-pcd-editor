import { RING_EDGE_ON } from "../../inspector/rings";
import { rotate } from "../../math/quat";
import { project } from "../../pick/ray";
import type { Vec3 } from "../../state/types";
import { type Camera, lookDirection } from "../../view/camera";
import { pxPerUnit } from "../../view/pointsize";
import type { HandleClass } from "./gizmo-math";
import type { BoxModel } from "./model";

export interface Handle {
  id: string;
  cls: HandleClass;
  axis: 0 | 1 | 2;
  sign: 1 | -1;
  /** Hit-test point (world, float64): the arrow tip, `handleLength` outside the face. For rings the nearest ring sample is used. */
  anchor: Vec3;
  /** Resize arrows: where the arrow starts, the centre of its face. */
  base?: Vec3;
  /** World direction of the handle's axis. */
  dir: Vec3;
  /** Ring sample points (world), rotate handles only. */
  ring?: Vec3[];
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const E: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const RING_SAMPLES = 48;
const add3 = (a: Vec3, b: Vec3, k: number): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

/** Arrow length, grab radii and marker size in screen pixels: the same at every zoom and window size. */
export const HANDLE_ARROW_PX = 72;
export const HANDLE_HIT_PX = 16;
export const HANDLE_RING_HIT_PX = 8;
/** A rotation ring is never drawn or grabbed larger than this on screen (also at most 0.3 x the shorter viewport side). */
export const RING_MAX_PX = 90;
export const HANDLE_CROSS_PX = 7;
const DEFAULT_VIEW_H = 720;

/** World length of an arrow handle for the camera and viewport height. */
export const handleLength = (cam: Camera, viewH: number = DEFAULT_VIEW_H): number => HANDLE_ARROW_PX / pxPerUnit(cam, Math.max(viewH, 1));

/** Handle geometry sized in pixels, so handles keep one screen size. `local` selects box or world axes. */
export function boxHandles(box: BoxModel, cam: Camera, local: boolean, viewH: number = DEFAULT_VIEW_H, viewW: number = viewH * 1.5): Handle[] {
  const len = handleLength(cam, viewH);
  const ringMax = Math.min(RING_MAX_PX, 0.3 * Math.min(viewW, viewH)) / pxPerUnit(cam, Math.max(viewH, 1));
  const half = box.dimensions.map((d) => d / 2) as Vec3;
  const localDir = (i: number): Vec3 => rotate(box.quat, E[i]);
  const out: Handle[] = [];
  for (const i of [0, 1, 2] as const) {
    const ld = localDir(i);
    for (const sign of [1, -1] as const) {
      // the arrow always follows the box's own axis, whatever frame the rings use
      out.push({ id: `resize-${i}${sign > 0 ? "+" : "-"}`, cls: "resize", axis: i, sign, anchor: add3(box.center, ld, sign * (half[i] + len)), base: add3(box.center, ld, sign * half[i]), dir: ld });
    }
    const td = local ? ld : E[i];
    const j = (i + 1) % 3;
    const k = (i + 2) % 3;
    const u = local ? localDir(j) : E[j];
    const v = local ? localDir(k) : E[k];
    const radius = Math.min(Math.hypot(half[j], half[k]) * 1.1 + len * 0.1, ringMax);
    const ring: Vec3[] = [];
    for (let s = 0; s < RING_SAMPLES; s++) {
      const t = (s / RING_SAMPLES) * 2 * Math.PI;
      ring.push(add3(add3(box.center, u, Math.cos(t) * radius), v, Math.sin(t) * radius));
    }
    out.push({ id: `rotate-${i}`, cls: "rotate", axis: i, sign: 1, anchor: ring[0], dir: td, ring });
  }
  return out;
}

const POINT_PX = HANDLE_HIT_PX;
const RING_PX = HANDLE_RING_HIT_PX;

/** The handle under a pixel: face arrow tips first (within 16 px), then rings. The box body is not a handle. */
export function hitHandle(
  handles: Handle[],
  cam: Camera,
  vp: { w: number; h: number },
  px: number,
  py: number,
): Handle | null {
  const zero: Vec3 = [0, 0, 0];
  const dist = (p: Vec3) => {
    const s = project(cam, p, zero, vp);
    return s ? Math.hypot(s.x - px, s.y - py) : Number.POSITIVE_INFINITY;
  };
  let arrow: Handle | null = null;
  let score = 1;
  for (const h of handles) {
    if (h.cls !== "resize") continue;
    const s = dist(h.anchor) / POINT_PX;
    if (s <= score) {
      score = s;
      arrow = h;
    }
  }
  if (arrow) return arrow;
  let best: Handle | null = null;
  let bd = RING_PX;
  for (const h of handles) {
    if (h.cls !== "rotate" || !h.ring) continue;
    if (Math.abs(dot(lookDirection(cam), h.dir)) < RING_EDGE_ON) continue; // an edge-on ring cannot be turned by a drag: leave it to the ring that faces the camera
    for (const p of h.ring) {
      const d = dist(p);
      if (d <= bd) {
        bd = d;
        best = h;
      }
    }
  }
  return best;
}
