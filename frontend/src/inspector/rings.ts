import type { AppState } from "../state/app";
import type { Vec3 } from "../state/types";
import { cross, normalize } from "../math/vec";
import { pxPerUnit } from "../view/pointsize";
import { protectionIntervals } from "./band";
import { type Tilt, isLevel, normalOf } from "./tilt";

/** Radius of a rotation ring on screen, and the points it is drawn and hit-tested with. */
export const RING_PX = 70;
export const RING_STEPS = 48;
/** A ring seen this close to edge-on (|look . axis| below it) is not grabbed. */
export const RING_EDGE_ON = 0.1;

const RAD = Math.PI / 180;

/**
 * The two rotation axes of the slab. The tilt is Ry(ry) Rx(rx): turning the slab about X' = Ry.x adds to rx
 * exactly, turning it about world Y adds to ry exactly (the angles compose in that order).
 */
export function ringAxes(t: Tilt): { x: Vec3; y: Vec3 } {
  const b = t.ry * RAD;
  return { x: [Math.cos(b), 0, -Math.sin(b)], y: [0, 1, 0] };
}

export interface TiltRing {
  id: "x" | "y";
  centre: Vec3;
  axis: Vec3;
  pts: Vec3[];
}

/** The pivot a tilt would use now: the active-bounds XY centre while level, else the stored pivot. */
export function pivotXY(s: AppState): [number, number] | null {
  const b = s.session?.active_bounds;
  if (!b) return null;
  const t = s.tools.protection.tilt;
  return isLevel(t) ? [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2] : [t.pivot[0], t.pivot[1]];
}

/** The slab mid-plane at the pivot, or null when no slab is on. */
export function slabCentre(s: AppState): Vec3 | null {
  const iv = protectionIntervals(s.tools.protection)[0];
  const p = pivotXY(s);
  if (!iv || !p) return null;
  const n = normalOf(s.tools.protection.tilt);
  const v = (iv.min + iv.max) / 2;
  return [p[0] + v * n[0], p[1] + v * n[1], v * n[2]];
}

/** The two rotation rings, only while the protection section is open, in the edited view with a slab on. */
export function tiltRings(s: AppState, viewH: number): TiltRing[] {
  const b = s.session?.active_bounds;
  const c = slabCentre(s);
  if (!b || !c || !s.floorPanelOpen || s.compare !== "edited") return [];
  const ext = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
  const r = Math.min(RING_PX / pxPerUnit(s.camera, Math.max(viewH, 1)), ext > 0 ? 0.4 * ext : Number.POSITIVE_INFINITY);
  const axes = ringAxes(s.tools.protection.tilt);
  return (["x", "y"] as const).map((id) => {
    const axis = axes[id];
    const helper: Vec3 = Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const u = normalize(cross(helper, axis));
    const w = cross(axis, u);
    const pts: Vec3[] = [];
    for (let k = 0; k < RING_STEPS; k++) {
      const a = (2 * Math.PI * k) / RING_STEPS;
      const ca = Math.cos(a) * r;
      const sa = Math.sin(a) * r;
      pts.push([c[0] + ca * u[0] + sa * w[0], c[1] + ca * u[1] + sa * w[1], c[2] + ca * u[2] + sa * w[2]]);
    }
    return { id, centre: c, axis, pts };
  });
}
