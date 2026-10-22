import { AXES, type Axis, type Side, sideActive, sideValue } from "../inspector/filters";
import type { AppState } from "../state/app";
import type { Bounds, Vec3 } from "../state/types";
import type { RenderTheme } from "../colour/palette";
import { pxPerUnit } from "../view/pointsize";
import { boxKey, isBoxCollapsed } from "./model";

/** Edge length of a filter plane on screen. */
export const PLANE_PX = 96;
/** Length of its arrow on screen. */
export const ARROW_PX = 40;
/** A plane is never larger than this share of the largest active-bounds extent. */
export const PLANE_CAP = 0.3;
/** Same colours as the ViewCube triad. */
export const AXIS_COLOUR: Record<Axis, number> = { x: 0xff5555, y: 0x55ff55, z: 0x5599ff };
/** The light theme's axis colours (R22-14, option B): arrows read at 3:1 on the light stage (3.73 / 3.03 / 3.99 on #e9ebef); the dimmed rings at 3:1 or more. */
export const LIGHT_AXIS_COLOUR: Record<Axis, number> = { x: 0xe0352b, y: 0x1f9b3b, z: 0x1f6fe0 };
/** The axis colours of a render theme; the dark ones are `AXIS_COLOUR` itself. */
export const axisColours = (theme: RenderTheme): Record<Axis, number> => (theme === "light" ? LIGHT_AXIS_COLOUR : AXIS_COLOUR);

export interface FilterPlane {
  /** `x-min` .. `z-max`. */
  key: string;
  axis: Axis;
  side: Side;
  /** The cut. */
  value: number;
  centre: Vec3;
  corners: Vec3[];
  /** The arrow runs from `base` (the plane centre) to `tip`, toward the hidden side. */
  base: Vec3;
  tip: Vec3;
}

const IDX: Record<Axis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };

/**
 * The filter planes to draw and grab: edited view only, one per expanded box whose side is active or being
 * interacted with (typing, grip or arrow drag). Collapsing hides a plane but keeps its filter.
 */
export function filterPlanes(s: AppState, viewH: number): FilterPlane[] {
  const sess = s.session;
  if (!sess?.bounds || s.compare !== "edited") return [];
  const b: Bounds = sess.bounds;
  const ab: Bounds = sess.active_bounds ?? b;
  const ppu = pxPerUnit(s.camera, Math.max(viewH, 1));
  const extent = Math.max(ab.max[0] - ab.min[0], ab.max[1] - ab.min[1], ab.max[2] - ab.min[2]);
  const side = Math.min(PLANE_PX / ppu, PLANE_CAP * extent);
  const arrow = ARROW_PX / ppu;
  const out: FilterPlane[] = [];
  for (const axis of AXES) {
    for (const sd of ["max", "min"] as Side[]) {
      const key = boxKey({ axis, side: sd });
      if (isBoxCollapsed(s.filterUi, key)) continue;
      if (!sideActive(s.tools.filters, b, axis, sd) && s.filterUi.interacting !== key) continue;
      const i = IDX[axis];
      const value = sideValue(s.tools.filters, b, axis, sd);
      const centre: Vec3 = [0, 0, 0];
      for (let k = 0; k < 3; k++) centre[k] = k === i ? value : Math.min(Math.max(s.camera.target[k], ab.min[k]), ab.max[k]);
      const [u, v] = ([0, 1, 2] as const).filter((k) => k !== i);
      const corner = (du: number, dv: number): Vec3 => {
        const c: Vec3 = [...centre];
        c[u] += (du * side) / 2;
        c[v] += (dv * side) / 2;
        return c;
      };
      const tip: Vec3 = [...centre];
      tip[i] += (sd === "min" ? -1 : 1) * arrow;
      out.push({ key, axis, side: sd, value, centre, corners: [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)], base: [...centre], tip });
    }
  }
  return out;
}
