import { colourRegion } from "../inspector/band";
import type { AppState } from "../state/app";

/**
 * Cache key of a point layer's colours: changes when the colour mode, the cloud, the height range or the
 * strong-colour region (section open flag and intervals) change; not with the camera. `withRegion` is false for
 * layers that never show the region (the original and deleted layers).
 */
export function layerColourKey(s: AppState, withRegion: boolean): string {
  const b = s.session?.active_bounds;
  const r = withRegion ? colourRegion(s) : null;
  const tilt = r?.tilt ? `@${r.tilt.rx}:${r.tilt.ry}:${r.tilt.pivot[0]}:${r.tilt.pivot[1]}` : "";
  const region = r ? r.intervals.map((i) => `${i.min}:${i.max}`).join(",") + tilt : "";
  const lay = s.colour.mode === "layers" ? (s.session?.layers ?? []).map((l) => `${l.id}:${l.colour}`).join(",") : "";
  return `${s.colour.mode}|${lay}|${s.selectedColour}|${s.session?.session_id}|${s.session?.revision.cloud}|${b?.min[2]}|${b?.max[2]}|${region}|${s.renderTheme}`;
}
