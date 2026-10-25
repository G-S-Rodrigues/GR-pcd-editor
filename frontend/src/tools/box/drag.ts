import { type Ray, type TurnState, advanceTurn, applyPrecision, resizeFace, ringAngle, ringPlaneHit, rotateBox, snap, translateDelta } from "./gizmo-math";
import type { Vec3 } from "../../state/types";
import type { Handle } from "./handles";
import type { BoxModel } from "./model";

export interface DragMods {
  symmetric: boolean;
  fine: boolean;
  snap: { on: boolean; step: number; angleStep: number };
}
export interface DragState {
  handle: Handle;
  box0: BoxModel;
  ray0: Ray;
  /** Ring drags: the running angle about the ring centre. Updated in place by dragBox; null until the first valid angle. */
  turn: TurnState | null;
  /** Ring drags: hold while the pointer is closer than this (world units) to the ring centre. */
  deadzone: number;
  ortho: boolean;
}

export function beginDrag(handle: Handle, box: BoxModel, ray: Ray, deadzone = 0, ortho = false): DragState {
  const a = handle.cls === "rotate" && handle.centre ? ringAngle(ray, handle.centre, handle.dir, ortho) : null;
  return { handle, box0: box, ray0: ray, turn: a === null ? null : { prev: a, total: 0 }, deadzone, ortho };
}

/**
 * One pointer move of a ring drag: the running turn after `ray`, or `turn` itself (a hold) while the ray is parallel to the ring
 * plane, the plane is behind the eye (perspective) or the pointer is within `deadzone` world units of the ring centre.
 * The first valid angle starts a turn at zero. Shared by the box rings and the band's tilt rings (22-3).
 */
export function advanceRing(turn: TurnState | null, ray: Ray, centre: Vec3, axis: Vec3, deadzone: number, ortho: boolean): TurnState | null {
  const hit = ringPlaneHit(ray, centre, axis, ortho);
  const near = hit !== null && Math.hypot(hit.point[0] - centre[0], hit.point[1] - centre[1], hit.point[2] - centre[2]) < deadzone;
  const now = hit && !near ? ringAngle(ray, centre, axis, ortho) : null;
  if (now === null) return turn;
  return turn ? advanceTurn(turn, now) : { prev: now, total: 0 };
}

/**
 * The box after dragging the handle until the pointer ray `ray`. A resize is derived from the box at drag start.
 * A ring drag accumulates the angle about the ring centre (turns past 180 degrees keep going) and holds, never
 * jumps, while the ray is parallel to the ring plane, the plane is behind the eye (perspective) or the pointer
 * is in the dead zone around the ring centre.
 */
export function dragBox(d: DragState, ray: Ray, mods: DragMods): BoxModel {
  const { handle: h, box0: b } = d;
  if (h.cls === "resize") {
    const out: [number, number, number] = [h.dir[0] * h.sign, h.dir[1] * h.sign, h.dir[2] * h.sign];
    let delta = applyPrecision(translateDelta(d.ray0, ray, h.anchor, out), mods.fine);
    if (mods.snap.on) delta = snap(delta, mods.snap.step);
    return resizeFace(b, h.axis, h.sign, delta, mods.symmetric);
  }
  if (!h.centre) return b;
  d.turn = advanceRing(d.turn, ray, h.centre, h.dir, d.deadzone, d.ortho);
  if (!d.turn) return b;
  let delta = applyPrecision(d.turn.total, mods.fine);
  if (mods.snap.on) delta = (snap((delta * 180) / Math.PI, mods.snap.angleStep) * Math.PI) / 180;
  return rotateBox(b, h.dir, delta);
}
