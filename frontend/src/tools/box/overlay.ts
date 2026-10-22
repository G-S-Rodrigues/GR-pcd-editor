import { cross, length, normalize, sub } from "../../math/vec";
import type { Vec3 } from "../../state/types";
import { type Camera, lookDirection, rightVector } from "../../view/camera";
import { pxPerUnit } from "../../view/pointsize";
import { AXIS_COLOUR } from "../../filterboxes/plane";
import { type Handle, boxHandles } from "./handles";
import type { BoxModel } from "./model";

/** Rings are drawn at this fraction of their axis colour (75%: contrast >= 3:1 against the clear colour); hovered, at the full colour. */
export const RING_TINT = 0.75;
/** Arrow head size in screen pixels: a filled triangle this long and twice HEAD_HALF wide. */
export const ARROW_HEAD_LEN_PX = 14;
export const ARROW_HEAD_HALF_PX = 5;
/** Drawn widths in pixels; the hovered arrow or ring gets the heavy one. */
export const ARROW_WIDTH_PX = 3;
export const ARROW_WIDTH_HOVER_PX = 4.5;
export const RING_WIDTH_PX = 2;
export const RING_WIDTH_HOVER_PX = 3.5;

const AXES = ["x", "y", "z"] as const;
/** `colour` with every channel scaled by `k`. */
export const dim = (colour: number, k: number): number =>
  (Math.round(((colour >> 16) & 255) * k) << 16) | (Math.round(((colour >> 8) & 255) * k) << 8) | Math.round((colour & 255) * k);

export interface ArrowSpec {
  id: string;
  /** On the face centre. */
  base: Vec3;
  /** The grab point, `handleLength` outside the face. */
  tip: Vec3;
  /** Where the shaft ends and the filled head begins, `ARROW_HEAD_LEN_PX` behind the tip. */
  headBase: Vec3;
  /** The two ends of the head's base, `ARROW_HEAD_HALF_PX` either side of headBase. */
  barbs: [Vec3, Vec3];
  colour: number;
  width: number;
}
export interface RingSpec {
  id: string;
  pts: Vec3[];
  colour: number;
  width: number;
}

/** What a set of 14b handles draws: arrows with heads and rings, the hovered one heavier. Pure; the three.js group only draws it. */
export function handleOverlaySpec(handles: Handle[], cam: Camera, hover: string | null, viewH: number): { arrows: ArrowSpec[]; rings: RingSpec[] } {
  const head = ARROW_HEAD_LEN_PX / pxPerUnit(cam, Math.max(viewH, 1));
  const half = ARROW_HEAD_HALF_PX / pxPerUnit(cam, Math.max(viewH, 1));
  const look = lookDirection(cam);
  const arrows: ArrowSpec[] = [];
  const rings: RingSpec[] = [];
  for (const h of handles) {
    if (h.cls === "rotate") {
      rings.push({ id: h.id, pts: h.ring ?? [], colour: hover === h.id ? AXIS_COLOUR[AXES[h.axis]] : dim(AXIS_COLOUR[AXES[h.axis]], RING_TINT), width: hover === h.id ? RING_WIDTH_HOVER_PX : RING_WIDTH_PX });
      continue;
    }
    const base = h.base ?? h.anchor;
    const shaft = sub(h.anchor, base);
    const len = length(shaft) || 1;
    const u: Vec3 = [shaft[0] / len, shaft[1] / len, shaft[2] / len];
    let side = cross(look, u);
    side = length(side) < 1e-6 ? rightVector(cam) : normalize(side);
    const headBase: Vec3 = [h.anchor[0] - u[0] * head, h.anchor[1] - u[1] * head, h.anchor[2] - u[2] * head];
    const barb = (k: number): Vec3 => [headBase[0] + k * side[0] * half, headBase[1] + k * side[1] * half, headBase[2] + k * side[2] * half];
    arrows.push({ id: h.id, base, tip: h.anchor, headBase, barbs: [barb(1), barb(-1)], colour: AXIS_COLOUR[AXES[h.axis]], width: hover === h.id ? ARROW_WIDTH_HOVER_PX : ARROW_WIDTH_PX });
  }
  return { arrows, rings };
}

/** What the box gizmo draws: six arrows with heads and six rings, the hovered one heavier. */
export function boxOverlaySpec(box: BoxModel, cam: Camera, hover: string | null, viewH: number): { arrows: ArrowSpec[]; rings: RingSpec[] } {
  return handleOverlaySpec(boxHandles(box, cam, viewH), cam, hover, viewH);
}
