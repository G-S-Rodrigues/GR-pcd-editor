import type { AppState } from "../state/app";
import type { Interval, ProtectionModel } from "./protection";
import { type Tilt, isLevel } from "./tilt";

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
