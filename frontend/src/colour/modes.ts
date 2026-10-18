import type { AttrArray } from "../render/parse";
import type { Bounds, FieldInfo, Vec3 } from "../state/types";
import { type Tilt, slabCoordinate } from "../inspector/tilt";
import { PALETTE, type Rgb } from "./palette";
import { RAMP_STOPS, rampAt } from "./ramps";

export type ColourMode = "turbo" | "viridis" | "flat";

export interface ColourOption {
  id: ColourMode;
  label: string;
  enabled: boolean;
  reason?: string;
  /** File field the render must carry for this mode (none of the current modes needs one). */
  attr?: string;
}

/** The colour modes; every one works on any file, so the schema does not matter. */
export function colourOptions(_schema: FieldInfo[]): ColourOption[] {
  return [
    { id: "turbo", label: "Height (Turbo)", enabled: true },
    { id: "viridis", label: "Height (Viridis)", enabled: true },
    { id: "flat", label: "Grey", enabled: true },
  ];
}

/** Colour of height z over [lo, hi] on a stop table (default Turbo), clamped; a zero range maps to the middle. */
export function heightRamp(z: number, lo: number, hi: number, stops: readonly Rgb[] = RAMP_STOPS.turbo): Rgb {
  return rampAt(stops, hi > lo ? (z - lo) / (hi - lo) : 0.5);
}

export interface ColourInput {
  coords: Float32Array;
  flags: Uint8Array;
  count: number;
  origin: Vec3;
  attr?: AttrArray;
  attrKind?: "f32" | "u32" | "i32";
}
export interface ColourContext {
  mode: ColourMode;
  bounds: Bounds | null;
  markDeleted: boolean;
  /** Protected slab intervals (Z, file frame) to draw strong; absent when the protection section is collapsed. */
  region?: { intervals: { min: number; max: number }[]; tilt?: Tilt } | null;
}

/** Per-point RGB (float 0..1); selection/protection/deleted flags override the base colour. */
export function colourize(r: ColourInput, ctx: ColourContext): Float32Array {
  const out = new Float32Array(r.count * 3);
  const lo = ctx.bounds ? ctx.bounds.min[2] : 0;
  const hi = ctx.bounds ? ctx.bounds.max[2] : 0;
  const stops = ctx.mode === "turbo" ? RAMP_STOPS.turbo : ctx.mode === "viridis" ? RAMP_STOPS.viridis : null;
  const region = ctx.region && ctx.region.intervals.length > 0 ? ctx.region : null;
  const tilt = region?.tilt;
  const inRegion = (i: number) => {
    const z = r.coords[3 * i + 2] + r.origin[2];
    const v = tilt ? slabCoordinate([r.coords[3 * i] + r.origin[0], r.coords[3 * i + 1] + r.origin[1], z], tilt) : z;
    return region?.intervals.some((iv) => v >= iv.min && v <= iv.max) ?? false;
  };
  for (let i = 0; i < r.count; i++) {
    const f = r.flags[i];
    let c: Rgb;
    if (f & 2) c = region ? PALETTE.protectedStrong : PALETTE.protected;
    else if (f & 8) c = PALETTE.previewAdd;
    else if (f & 16) c = PALETTE.previewRemove;
    else if (f & 1) c = PALETTE.selected;
    else if (f & 4 && ctx.markDeleted) c = PALETTE.deleted;
    else if (region && inRegion(i)) c = PALETTE.protectedStrong;
    else if (stops) c = heightRamp(r.coords[3 * i + 2] + r.origin[2], lo, hi, stops);
    else c = PALETTE.base;
    out[3 * i] = c[0];
    out[3 * i + 1] = c[1];
    out[3 * i + 2] = c[2];
  }
  return out;
}
