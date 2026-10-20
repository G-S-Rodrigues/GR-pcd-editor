import { cross, length, normalize, sub } from "../../math/vec";
import type { Vec3 } from "../../state/types";
import { type Camera, lookDirection, rightVector } from "../../view/camera";
import { pxPerUnit } from "../../view/pointsize";
import { boxHandles } from "./handles";
import type { BoxModel } from "./model";

/** Colours of the box gizmo: the orange handle colour for the face arrows, the light blue of the tilt rings for the three rings. */
export const BOX_ARROW_COLOUR = 0xff9f1c;
export const BOX_RING_COLOUR = 0x6ec1ff;
/** Arrow head size in screen pixels. */
export const ARROW_HEAD_PX = 9;
/** Drawn widths in pixels; the hovered arrow or ring gets the heavy one. */
export const ARROW_WIDTH_PX = 1.8;
export const ARROW_WIDTH_HOVER_PX = 3.6;
export const RING_WIDTH_PX = 1;
export const RING_WIDTH_HOVER_PX = 2.6;

export interface ArrowSpec {
  id: string;
  /** On the face centre. */
  base: Vec3;
  /** The grab point, `handleLength` outside the face. */
  tip: Vec3;
  /** The two ends of the head, behind the tip. */
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

/** What the box gizmo draws: six arrows with heads and three rings, the hovered one heavier. Pure; the three.js group only draws it. */
export function boxOverlaySpec(box: BoxModel, cam: Camera, local: boolean, hover: string | null, viewH: number, viewW: number): { arrows: ArrowSpec[]; rings: RingSpec[] } {
  const head = ARROW_HEAD_PX / pxPerUnit(cam, Math.max(viewH, 1));
  const look = lookDirection(cam);
  const arrows: ArrowSpec[] = [];
  const rings: RingSpec[] = [];
  for (const h of boxHandles(box, cam, local, viewH, viewW)) {
    if (h.cls === "rotate") {
      rings.push({ id: h.id, pts: h.ring ?? [], colour: BOX_RING_COLOUR, width: hover === h.id ? RING_WIDTH_HOVER_PX : RING_WIDTH_PX });
      continue;
    }
    const base = h.base ?? h.anchor;
    const shaft = sub(h.anchor, base);
    const len = length(shaft) || 1;
    const u: Vec3 = [shaft[0] / len, shaft[1] / len, shaft[2] / len];
    let side = cross(look, u);
    side = length(side) < 1e-6 ? rightVector(cam) : normalize(side);
    const barb = (k: number): Vec3 => [h.anchor[0] - u[0] * head + k * side[0] * head * 0.5, h.anchor[1] - u[1] * head + k * side[1] * head * 0.5, h.anchor[2] - u[2] * head + k * side[2] * head * 0.5];
    arrows.push({ id: h.id, base, tip: h.anchor, barbs: [barb(1), barb(-1)], colour: BOX_ARROW_COLOUR, width: hover === h.id ? ARROW_WIDTH_HOVER_PX : ARROW_WIDTH_PX });
  }
  return { arrows, rings };
}
