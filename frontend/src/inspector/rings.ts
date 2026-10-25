import type { AppState } from "../state/app";
import type { Vec3 } from "../state/types";
import { type Tilt, isLevel } from "./tilt";

const RAD = Math.PI / 180;

/**
 * The two rotation axes of the slab. The tilt is Ry(ry) Rx(rx): turning the slab about X' = Ry.x adds to rx
 * exactly, turning it about world Y adds to ry exactly (the angles compose in that order).
 */
export function ringAxes(t: Tilt): { x: Vec3; y: Vec3 } {
  const b = t.ry * RAD;
  return { x: [Math.cos(b), 0, -Math.sin(b)], y: [0, 1, 0] };
}

/** The pivot a tilt would use now: the active-bounds XY centre while level, else the stored pivot. */
export function pivotXY(s: AppState): [number, number] | null {
  const b = s.session?.active_bounds;
  if (!b) return null;
  const t = s.tools.protection.tilt;
  return isLevel(t) ? [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2] : [t.pivot[0], t.pivot[1]];
}
