import { fromAxisAngle, mul, normalizeQ, rotate } from "../../math/quat";
import type { Vec3 } from "../../state/types";
import { type Camera, lookDirection, rightVector, upVector } from "../../view/camera";
import { type BoxModel, MIN_EXTENT } from "./model";

export interface KeyMods {
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
}
export interface KeySteps {
  /** Metres per nudge and per resized face (Gizmo "Step"). */
  step: number;
  /** Degrees per turn (Gizmo "Angle step"). */
  angleStep: number;
}

/** Shift makes every keyboard edit a tenth as large. */
const FINE = 0.1;
const AXES: Vec3[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The signed unit world axis closest to a direction. */
function nearestWorld(d: Vec3): Vec3 {
  let i = 0;
  for (let k = 1; k < 3; k++) if (Math.abs(d[k]) > Math.abs(d[i])) i = k;
  const v: Vec3 = [0, 0, 0];
  v[i] = d[i] < 0 ? -1 : 1;
  return v;
}

/** The box axis index whose world direction is closest to d, and the sign that makes it point along d. */
function nearestBoxAxis(b: BoxModel, d: Vec3): { i: number; sign: 1 | -1 } {
  let best = 0;
  let bd = -1;
  let sign: 1 | -1 = 1;
  AXES.forEach((a, i) => {
    const t = dot(rotate(b.quat, a), d);
    if (Math.abs(t) > bd + 1e-12) {
      bd = Math.abs(t);
      best = i;
      sign = t < 0 ? -1 : 1;
    }
  });
  return { i: best, sign };
}

/**
 * One keyboard edit of the box, or null when the key is not one (pure; the caller checks the Box tool and the focus):
 * arrows nudge along the world axes nearest the screen right and up, PageUp and PageDown along the view axis; Alt+arrows
 * grow (Right, Up) or shrink (Left, Down) both faces of the box axis nearest that screen direction; `.` and `,` turn the
 * box by the Angle step (about its Z axis, with Shift about the box axis nearest screen-right, with Ctrl+Shift about the
 * view axis, counter-clockwise on screen for `.`).
 */
export function keyEditBox(box: BoxModel, key: string, mods: KeyMods, cam: Camera, steps: KeySteps): BoxModel | null {
  const f = mods.shift ? FINE : 1;
  const right = rightVector(cam);
  const up = upVector(cam);
  const toEye = lookDirection(cam).map((v) => -v) as Vec3;
  if (key === "ArrowRight" || key === "ArrowLeft" || key === "ArrowUp" || key === "ArrowDown" || key === "PageUp" || key === "PageDown") {
    const horizontal = key === "ArrowRight" || key === "ArrowLeft";
    const positive = key === "ArrowRight" || key === "ArrowUp" || key === "PageUp";
    if (mods.alt) {
      if (key === "PageUp" || key === "PageDown") return null;
      const { i } = nearestBoxAxis(box, horizontal ? right : up);
      const dimensions = [...box.dimensions] as Vec3;
      dimensions[i] = Math.max(MIN_EXTENT, dimensions[i] + (positive ? 1 : -1) * 2 * steps.step * f);
      return { ...box, dimensions };
    }
    const axis = nearestWorld(key === "PageUp" || key === "PageDown" ? toEye : horizontal ? right : up);
    const d = (positive ? 1 : -1) * steps.step * f;
    return { ...box, center: [box.center[0] + axis[0] * d, box.center[1] + axis[1] * d, box.center[2] + axis[2] * d] };
  }
  const sign = key === "." || key === ">" ? 1 : key === "," || key === "<" ? -1 : 0;
  if (sign === 0) return null;
  let axis: Vec3;
  if (mods.ctrl && mods.shift) axis = toEye;
  else if (mods.shift) {
    const { i, sign: s } = nearestBoxAxis(box, right);
    axis = rotate(box.quat, AXES[i].map((v) => v * s) as Vec3);
  } else axis = rotate(box.quat, [0, 0, 1]);
  const turn = fromAxisAngle(axis, (sign * steps.angleStep * Math.PI) / 180);
  return { ...box, quat: normalizeQ(mul(turn, box.quat)) };
}
