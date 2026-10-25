import type { AppState } from "../state/app";
import type { Vec3 } from "../state/types";
import { handleLength } from "../tools/box/handles";
import type { Interval, ProtectionModel } from "./protection";
import { type Tilt, isLevel, normalOf, slabZ } from "./tilt";

/**
 * The protected slab intervals the client model describes right now (no round trip): inherit uses the global
 * slab, add_local adds the local one, override uses only the local one. Disabled or missing slabs give nothing.
 */
export function protectionIntervals(m: ProtectionModel): Interval[] {
  const g: Interval[] = m.global.enabled ? [{ min: m.global.min, max: m.global.max }] : [];
  const l: Interval[] = m.local ? [{ min: m.local.min, max: m.local.max }] : [];
  if (m.mode === "override") return l;
  if (m.mode === "add_local") return [...g, ...l];
  return g;
}

export interface ColourRegion {
  intervals: Interval[];
  /** Only present when the slab is tilted (the intervals are then slab coordinates). */
  tilt?: Tilt;
}

/** The strong-colour region: only while the protection section is open and at least one interval is on. */
export function colourRegion(s: AppState): ColourRegion | null {
  if (!s.session || !s.floorPanelOpen) return null;
  const intervals = protectionIntervals(s.tools.protection);
  if (intervals.length === 0) return null;
  const tilt = s.tools.protection.tilt;
  return isLevel(tilt) ? { intervals } : { intervals, tilt };
}

export type PlaneKey = { which: "global" | "local"; edge: "min" | "max" };

export interface PlaneAnchor {
  key: PlaneKey;
  /** Where the plane's arrow starts: the XY centre of the active bounds at the plane's height. */
  anchor: Vec3;
  /** Arrow tip, pointing away from the band (the lower plane down, the upper one up), as long as a Box arrow (`handleLength`, 72 px on screen). */
  tip: Vec3;
  /** The footprint outline of the plane, four corners in order. */
  corners: Vec3[];
}

/** The protection planes' arrows and outlines, at the XY centre and over the footprint of the active bounds. */
export function planeAnchors(s: AppState, viewH = 720): PlaneAnchor[] {
  const b = s.session?.active_bounds;
  if (!b) return [];
  const cx = (b.min[0] + b.max[0]) / 2;
  const cy = (b.min[1] + b.max[1]) / 2;
  const len = handleLength(s.camera, viewH);
  const p = s.tools.protection;
  const n = normalOf(p.tilt);
  const out: PlaneAnchor[] = [];
  const add = (which: PlaneKey["which"], edge: PlaneKey["edge"], v: number) => {
    const at = (x: number, y: number): Vec3 => [x, y, slabZ(p.tilt, v, x, y)];
    const anchor = at(cx, cy);
    const k = edge === "max" ? len : -len;
    out.push({
      key: { which, edge },
      anchor,
      tip: [anchor[0] + k * n[0], anchor[1] + k * n[1], anchor[2] + k * n[2]],
      corners: [at(b.min[0], b.min[1]), at(b.max[0], b.min[1]), at(b.max[0], b.max[1]), at(b.min[0], b.max[1])],
    });
  };
  if (p.global.enabled) {
    add("global", "min", p.global.min);
    add("global", "max", p.global.max);
  }
  if (p.mode !== "inherit" && p.local) {
    add("local", "min", p.local.min);
    add("local", "max", p.local.max);
  }
  return out;
}
