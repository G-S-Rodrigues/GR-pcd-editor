import { END_ON_DOT } from "../../filterboxes/drag";
import { segDist } from "../../math/seg2d";
import { cross, dot, length, normalize, scale, sub } from "../../math/vec";
import { rotate } from "../../math/quat";
import { project } from "../../pick/ray";
import type { Vec3 } from "../../state/types";
import { type Camera, eyePosition, lookDirection, rightVector } from "../../view/camera";
import { pxPerUnit } from "../../view/pointsize";
import type { HandleClass } from "./gizmo-math";
import type { BoxModel } from "./model";

export interface Handle {
  id: string;
  cls: HandleClass;
  axis: 0 | 1 | 2;
  sign: 1 | -1;
  /** Hit-test point (world, float64): the arrow tip, `handleLength` outside the face. For rings the widest screen point. */
  anchor: Vec3;
  /** Resize arrows: where the arrow starts, the centre of its face. */
  base?: Vec3;
  /** World direction of the handle's axis (the arrow's own box axis; a ring turns the box about it). */
  dir: Vec3;
  /** Ring sample points (world), rotate handles only. */
  ring?: Vec3[];
  /** Rotate handles: the ring centre (on the arrow shaft) and its world radius. */
  centre?: Vec3;
  radius?: number;
}

const E: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const RING_SAMPLES = 32;
const add3 = (a: Vec3, b: Vec3, k: number): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

/** Arrow length, grab radii and marker size in screen pixels: the same at every zoom and window size. */
export const HANDLE_ARROW_PX = 72;
export const HANDLE_HIT_PX = 16;
/** A ring is grabbed within this many pixels of its drawn outline (not inside it: the inside still moves the box). */
export const HANDLE_RING_HIT_PX = 6;
/** Each arrow carries a ring centred on its shaft at this fraction of the arrow length from the face. */
export const RING_AT = 1 / 3;
export const RING_RADIUS_PX = 8;
/** A ring seen this close to edge-on (|view . axis| below it) is not picked or hovered; at 8 px it is then 4 px wide. */
export const RING_PICK_EDGE_ON = 0.25;
/** A ring drag holds while the pointer is this close to the ring centre. */
export const RING_DEADZONE_PX = 2;
export const HANDLE_CROSS_PX = 7;
const DEFAULT_VIEW_H = 720;

/** World length of an arrow handle for the camera and viewport height. */
export const handleLength = (cam: Camera, viewH: number = DEFAULT_VIEW_H): number => HANDLE_ARROW_PX / pxPerUnit(cam, Math.max(viewH, 1));

/**
 * A ring of `radius` world units on the shaft that runs from `base` along `sign * dir`: centred `RING_AT * len` out, `RING_SAMPLES`
 * points in the plane normal to `dir`, and the widest point on screen (perpendicular to the view and to `dir`).
 * The box handles and the height-protection band (22-3) share it, so both draw the same 14b ring.
 */
export function shaftRing(base: Vec3, dir: Vec3, sign: 1 | -1, len: number, radius: number, cam: Camera, look: Vec3): { ring: Vec3[]; centre: Vec3; anchor: Vec3 } {
  const helper: Vec3 = Math.abs(dir[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = normalize(cross(helper, dir));
  const w = cross(dir, u);
  const centre = add3(base, dir, sign * RING_AT * len);
  const ring: Vec3[] = [];
  for (let s = 0; s < RING_SAMPLES; s++) {
    const t = (s / RING_SAMPLES) * 2 * Math.PI;
    ring.push(add3(add3(centre, u, Math.cos(t) * radius), w, Math.sin(t) * radius));
  }
  // the widest point on screen: perpendicular to both the view and the axis
  let side = cross(look, dir);
  side = length(side) < 1e-6 ? rightVector(cam) : normalize(side);
  return { ring, centre, anchor: add3(centre, side, radius) };
}

/** Handle geometry sized in pixels, so handles keep one screen size: six arrows, each with a small ring on its shaft. */
export function boxHandles(box: BoxModel, cam: Camera, viewH: number = DEFAULT_VIEW_H): Handle[] {
  const ppu = pxPerUnit(cam, Math.max(viewH, 1));
  const len = HANDLE_ARROW_PX / ppu;
  const radius = RING_RADIUS_PX / ppu;
  const half = box.dimensions.map((d) => d / 2) as Vec3;
  const look = lookDirection(cam);
  const out: Handle[] = [];
  for (const i of [0, 1, 2] as const) {
    const ld = rotate(box.quat, E[i]);
    for (const sign of [1, -1] as const) {
      const tag = sign > 0 ? "+" : "-";
      const base = add3(box.center, ld, sign * half[i]);
      out.push({ id: `resize-${i}${tag}`, cls: "resize", axis: i, sign, anchor: add3(box.center, ld, sign * (half[i] + len)), base, dir: ld });
      const { ring, centre, anchor } = shaftRing(base, ld, sign, len, radius, cam, look);
      out.push({ id: `rotate-${i}${tag}`, cls: "rotate", axis: i, sign, anchor, dir: ld, ring, centre, radius });
    }
  }
  return out;
}

const POINT_PX = HANDLE_HIT_PX;

/** The unit vector from a ring centre towards the eye (perspective) or against the view (ortho). */
const viewVector = (cam: Camera, centre: Vec3): Vec3 => {
  if (cam.ortho) return scale(lookDirection(cam), -1);
  return normalize(sub(eyePosition(cam), centre));
};

/**
 * The handle under a pixel. Rings first: within 6 px of a ring's outline, never when it is edge-on to its own
 * eye ray; the nearest outline wins, and within half a pixel the ring whose arrow points more towards the eye.
 * Then arrow tips (within 16 px), except arrows seen end-on. The box body is not a handle.
 */
export function hitHandle(handles: Handle[], cam: Camera, vp: { w: number; h: number }, px: number, py: number): Handle | null {
  const zero: Vec3 = [0, 0, 0];
  const look = lookDirection(cam);
  let ring: Handle | null = null;
  let rd = Number.POSITIVE_INFINITY;
  let facing = Number.NEGATIVE_INFINITY;
  for (const h of handles) {
    if (h.cls !== "rotate" || !h.ring || !h.centre) continue;
    const v = viewVector(cam, h.centre);
    if (Math.abs(dot(v, h.dir)) < RING_PICK_EDGE_ON) continue;
    const pts = h.ring.map((p) => project(cam, p, zero, vp));
    if (pts.some((q) => !q)) continue;
    let d = Number.POSITIVE_INFINITY;
    for (let k = 0; k < pts.length; k++) d = Math.min(d, segDist({ x: px, y: py }, pts[k]!, pts[(k + 1) % pts.length]!));
    if (d > HANDLE_RING_HIT_PX) continue;
    const f = dot(scale(h.dir, h.sign), v);
    if (!ring || d < rd - 0.5 || (Math.abs(d - rd) <= 0.5 && f > facing)) {
      ring = h;
      rd = d;
      facing = f;
    }
  }
  if (ring) return ring;
  let arrow: Handle | null = null;
  let score = 1;
  for (const h of handles) {
    if (h.cls !== "resize") continue;
    if (Math.abs(dot(look, h.dir)) > END_ON_DOT) continue;
    const q = project(cam, h.anchor, zero, vp);
    const s = (q ? Math.hypot(q.x - px, q.y - py) : Number.POSITIVE_INFINITY) / POINT_PX;
    if (s <= score) {
      score = s;
      arrow = h;
    }
  }
  return arrow;
}
