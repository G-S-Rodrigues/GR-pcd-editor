import { type Ray, applyPrecision, resizeFace, ringAngle, rotateBox, rotationDelta, snap, translateDelta } from "./gizmo-math";
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
  angle0: number | null;
}

export function beginDrag(handle: Handle, box: BoxModel, ray: Ray): DragState {
  return {
    handle,
    box0: box,
    ray0: ray,
    angle0: handle.cls === "rotate" ? ringAngle(ray, box.center, handle.dir) : null,
  };
}

/** The box after dragging the handle until the pointer ray `ray`; always derived from the box at drag start. */
export function dragBox(d: DragState, ray: Ray, mods: DragMods): BoxModel {
  const { handle: h, box0: b } = d;
  if (h.cls === "resize") {
    const out: [number, number, number] = [h.dir[0] * h.sign, h.dir[1] * h.sign, h.dir[2] * h.sign];
    let delta = applyPrecision(translateDelta(d.ray0, ray, h.anchor, out), mods.fine);
    if (mods.snap.on) delta = snap(delta, mods.snap.step);
    return resizeFace(b, h.axis, h.sign, delta, mods.symmetric);
  }
  const now = ringAngle(ray, b.center, h.dir);
  if (now === null || d.angle0 === null) return b;
  let delta = applyPrecision(rotationDelta(d.angle0, now), mods.fine);
  if (mods.snap.on) delta = (snap((delta * 180) / Math.PI, mods.snap.angleStep) * Math.PI) / 180;
  return rotateBox(b, h.dir, delta);
}
