import { rotate } from "../../math/quat";
import { project } from "../../pick/ray";
import type { Vec3 } from "../../state/types";
import { type Camera } from "../../view/camera";
import { pxPerUnit } from "../../view/pointsize";
import type { HandleClass } from "./gizmo-math";
import type { BoxModel } from "./model";

export interface Handle {
  id: string;
  cls: HandleClass;
  axis: 0 | 1 | 2;
  sign: 1 | -1;
  /** Hit-test point (world, float64): arrow tip, face centre. For rings the nearest ring sample is used. */
  anchor: Vec3;
  /** World direction of the handle's axis. */
  dir: Vec3;
  /** Ring sample points (world), rotate handles only. */
  ring?: Vec3[];
}

const E: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const RING_SAMPLES = 48;
const add3 = (a: Vec3, b: Vec3, k: number): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

/** Arrow length, grab radii and marker size in screen pixels: the same at every zoom and window size. */
export const HANDLE_ARROW_PX = 72;
export const HANDLE_HIT_PX = 16;
export const HANDLE_RING_HIT_PX = 10;
export const HANDLE_CROSS_PX = 7;
const DEFAULT_VIEW_H = 720;

/** World length of an arrow handle for the camera and viewport height. */
export const handleLength = (cam: Camera, viewH: number = DEFAULT_VIEW_H): number => HANDLE_ARROW_PX / pxPerUnit(cam, Math.max(viewH, 1));

/** Handle geometry sized in pixels, so handles keep one screen size. `local` selects box or world axes. */
export function boxHandles(box: BoxModel, cam: Camera, local: boolean, viewH: number = DEFAULT_VIEW_H): Handle[] {
  const len = handleLength(cam, viewH);
  const half = box.dimensions.map((d) => d / 2) as Vec3;
  const localDir = (i: number): Vec3 => rotate(box.quat, E[i]);
  const out: Handle[] = [];
  for (const i of [0, 1, 2] as const) {
    const ld = localDir(i);
    for (const sign of [1, -1] as const) {
      out.push({ id: `resize-${i}${sign > 0 ? "+" : "-"}`, cls: "resize", axis: i, sign, anchor: add3(box.center, ld, sign * half[i]), dir: ld });
    }
    const td = local ? ld : E[i];
    out.push({ id: `translate-${i}`, cls: "translate", axis: i, sign: 1, anchor: add3(box.center, td, half[i] + len), dir: td });
    const j = (i + 1) % 3;
    const k = (i + 2) % 3;
    const u = local ? localDir(j) : E[j];
    const v = local ? localDir(k) : E[k];
    const radius = Math.hypot(half[j], half[k]) * 1.1 + len * 0.1;
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

/** The handle under a pixel: resize squares first, then arrow tips, then rings. */
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
  for (const cls of ["resize", "translate"] as const) {
    let best: Handle | null = null;
    let bd = POINT_PX;
    for (const h of handles) {
      if (h.cls !== cls) continue;
      const d = dist(h.anchor);
      if (d <= bd) {
        bd = d;
        best = h;
      }
    }
    if (best) return best;
  }
  let best: Handle | null = null;
  let bd = RING_PX;
  for (const h of handles) {
    if (h.cls !== "rotate" || !h.ring) continue;
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
