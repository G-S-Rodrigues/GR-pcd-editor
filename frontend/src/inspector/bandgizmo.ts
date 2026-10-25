import { axisColours } from "../filterboxes/plane";
import type { AppState } from "../state/app";
import type { Vec3 } from "../state/types";
import { type Handle, RING_RADIUS_PX, handleLength, shaftRing } from "../tools/box/handles";
import { ARROW_WIDTH_PX, type ArrowSpec, type RingSpec, handleOverlaySpec } from "../tools/box/overlay";
import { lookDirection } from "../view/camera";
import { pxPerUnit } from "../view/pointsize";
import { type PlaneAnchor, type PlaneKey, planeAnchors, protectionIntervals } from "./band";
import { ringAxes } from "./rings";
import { normalOf, slabZ } from "./tilt";

/** One of the band's z arrows: a 14b resize handle on a protection plane. */
export interface BandArrow {
  id: string;
  key: PlaneKey;
  plane: PlaneAnchor;
  handle: Handle;
}
/** One of the band's four tilt rings: a 14b rotate handle on a headless shaft at an X or Y side face. */
export interface BandRing {
  id: string;
  which: "x" | "y";
  handle: Handle;
}
/** The headless shaft a tilt ring sits on (drawn as a plain line). */
export interface ShaftSpec {
  id: string;
  base: Vec3;
  tip: Vec3;
  colour: number;
  width: number;
}
/** The slab between an interval's two planes: the 8 corners (lower plane first), drawn as a translucent box. */
export interface BandFill {
  which: "global" | "local";
  corners: Vec3[];
}
export interface BandOutline {
  id: string;
  corners: Vec3[];
}

const EMPTY_GIZMO = (): { arrows: BandArrow[]; rings: BandRing[]; shafts: ShaftSpec[]; handles: Handle[] } => ({ arrows: [], rings: [], shafts: [], handles: [] });
const EMPTY_OVERLAY = (): { fills: BandFill[]; outlines: BandOutline[]; arrows: ArrowSpec[]; rings: RingSpec[]; shafts: ShaftSpec[] } => ({
  fills: [],
  outlines: [],
  arrows: [],
  rings: [],
  shafts: [],
});

/**
 * The height-protection band's handles, built from the Box gizmo's 14b parts (R22-4): a z arrow on each protection plane, and
 * while the section is open four tilt rings on headless X and Y shafts at the footprint's side faces, on the slab mid-plane.
 * Everything is empty while "Show band" is off (R22-11), with no session, outside the Edited view, or with no plane on.
 */
export function bandGizmo(s: AppState, viewH: number): { arrows: BandArrow[]; rings: BandRing[]; shafts: ShaftSpec[]; handles: Handle[] } {
  const b = s.session?.active_bounds;
  if (!s.session || !b || s.compare !== "edited" || !s.bandVisible) return EMPTY_GIZMO();
  const planes = planeAnchors(s, viewH);
  if (planes.length === 0) return EMPTY_GIZMO();
  const normal = normalOf(s.tools.protection.tilt);
  const arrows: BandArrow[] = planes.map((plane) => {
    const handle: Handle = {
      id: `band-${plane.key.which}-${plane.key.edge}`,
      cls: "resize",
      axis: 2,
      sign: plane.key.edge === "max" ? 1 : -1,
      base: plane.anchor,
      anchor: plane.tip,
      dir: normal, // unsigned, as the Box arrows' dir
    };
    return { id: handle.id, key: plane.key, plane, handle };
  });
  const rings: BandRing[] = [];
  const shafts: ShaftSpec[] = [];
  const axes = axisColours(s.renderTheme);
  const iv = protectionIntervals(s.tools.protection)[0];
  if (s.floorPanelOpen && iv) {
    const t = s.tools.protection.tilt;
    const mid = (iv.min + iv.max) / 2;
    const cx = (b.min[0] + b.max[0]) / 2;
    const cy = (b.min[1] + b.max[1]) / 2;
    const len = handleLength(s.camera, viewH);
    const radius = RING_RADIUS_PX / pxPerUnit(s.camera, Math.max(viewH, 1));
    const look = lookDirection(s.camera);
    for (const which of ["x", "y"] as const) {
      const x = which === "x";
      // `dir` is unsigned, as in the Box: the + and - rings of one axis turn the slab the same way
      const dir: Vec3 = x ? ringAxes(t).x : [0, 1, 0];
      for (const sign of [1, -1] as const) {
        const tag = sign > 0 ? "+" : "-";
        const px = x ? (sign > 0 ? b.max[0] : b.min[0]) : cx;
        const py = x ? cy : sign > 0 ? b.max[1] : b.min[1];
        const base: Vec3 = [px, py, slabZ(t, mid, px, py)];
        const { ring, centre, anchor } = shaftRing(base, dir, sign, len, radius, s.camera, look);
        const id = `tilt-${which}${tag}`;
        const handle: Handle = { id, cls: "rotate", axis: x ? 0 : 1, sign, dir, ring, centre, radius, anchor };
        rings.push({ id, which, handle });
        shafts.push({
          id: `shaft-${which}${tag}`,
          base,
          tip: [base[0] + sign * len * dir[0], base[1] + sign * len * dir[1], base[2] + sign * len * dir[2]],
          colour: axes[which],
          width: ARROW_WIDTH_PX,
        });
      }
    }
  }
  return { arrows, rings, shafts, handles: [...arrows.map((a) => a.handle), ...rings.map((r) => r.handle)] };
}

/** Everything the band draws, as plain data: fill, outlines, 14b arrows and rings, headless shafts. Empty while the band is hidden. */
export function bandOverlaySpec(
  s: AppState,
  viewH: number,
): { fills: BandFill[]; outlines: BandOutline[]; arrows: ArrowSpec[]; rings: RingSpec[]; shafts: ShaftSpec[] } {
  const g = bandGizmo(s, viewH);
  if (g.arrows.length === 0) return EMPTY_OVERLAY();
  const fills: BandFill[] = [];
  for (const which of ["global", "local"] as const) {
    const lo = g.arrows.find((a) => a.key.which === which && a.key.edge === "min");
    const hi = g.arrows.find((a) => a.key.which === which && a.key.edge === "max");
    if (lo && hi) fills.push({ which, corners: [...lo.plane.corners, ...hi.plane.corners] });
  }
  const outlines = g.arrows.map((a): BandOutline => ({ id: a.id, corners: a.plane.corners }));
  const { arrows, rings } = handleOverlaySpec(g.handles, s.camera, null, viewH, axisColours(s.renderTheme));
  return { fills, outlines, arrows, rings, shafts: g.shafts };
}
