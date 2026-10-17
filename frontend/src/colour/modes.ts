import type { AttrArray } from "../render/parse";
import type { Bounds, FieldInfo, Vec3 } from "../state/types";
import { PALETTE, type Rgb } from "./palette";

export type ColourMode = "height" | "rgb" | "intensity" | "flat";

export interface ColourOption {
  id: ColourMode;
  label: string;
  enabled: boolean;
  reason?: string;
  attr?: string;
}

export function colourOptions(schema: FieldInfo[]): ColourOption[] {
  const has = (n: string) => schema.some((s) => s.name === n);
  const rgbField = has("rgb") ? "rgb" : has("rgba") ? "rgba" : undefined;
  return [
    { id: "height", label: "Height (Z)", enabled: true },
    rgbField
      ? { id: "rgb", label: "RGB", enabled: true, attr: rgbField }
      : { id: "rgb", label: "RGB", enabled: false, reason: "This file has no rgb or rgba field" },
    has("intensity")
      ? { id: "intensity", label: "Intensity", enabled: true, attr: "intensity" }
      : { id: "intensity", label: "Intensity", enabled: false, reason: "This file has no intensity field" },
    { id: "flat", label: "Flat grey", enabled: true },
  ];
}

const STOPS: Rgb[] = [
  [0.267, 0.005, 0.329],
  [0.231, 0.322, 0.546],
  [0.128, 0.567, 0.551],
  [0.369, 0.789, 0.383],
  [0.993, 0.906, 0.144],
];

/** Viridis-like ramp over [lo, hi], clamped; a zero range maps to the middle. */
export function heightRamp(z: number, lo: number, hi: number): Rgb {
  const t = hi > lo ? Math.min(1, Math.max(0, (z - lo) / (hi - lo))) : 0.5;
  const f = t * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(f));
  const u = f - i;
  const a = STOPS[i];
  const b = STOPS[i + 1];
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

/** `bits` holds uint32 words (a float32 attr is viewed over the same bytes); layout 0xAARRGGBB, alpha ignored. */
export function decodePackedRgb(bits: Uint32Array, i: number): Rgb {
  const v = bits[i];
  return [((v >>> 16) & 255) / 255, ((v >>> 8) & 255) / 255, (v & 255) / 255];
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
}

/** Per-point RGB (float 0..1); selection/protection/deleted flags override the base colour. */
export function colourize(r: ColourInput, ctx: ColourContext): Float32Array {
  const out = new Float32Array(r.count * 3);
  const lo = ctx.bounds ? ctx.bounds.min[2] : 0;
  const hi = ctx.bounds ? ctx.bounds.max[2] : 0;
  let bits: Uint32Array | null = null;
  if (ctx.mode === "rgb" && r.attr) bits = new Uint32Array(r.attr.buffer, r.attr.byteOffset, r.count);
  let imin = 0;
  let imax = 0;
  if (ctx.mode === "intensity" && r.attr) {
    imin = Number.POSITIVE_INFINITY;
    imax = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < r.count; i++) {
      const v = r.attr[i];
      if (Number.isFinite(v)) {
        imin = Math.min(imin, v);
        imax = Math.max(imax, v);
      }
    }
  }
  for (let i = 0; i < r.count; i++) {
    const f = r.flags[i];
    let c: Rgb;
    if (f & 2) c = PALETTE.protected;
    else if (f & 1) c = PALETTE.selected;
    else if (f & 4 && ctx.markDeleted) c = PALETTE.deleted;
    else if (ctx.mode === "height") c = heightRamp(r.coords[3 * i + 2] + r.origin[2], lo, hi);
    else if (ctx.mode === "rgb" && bits) c = decodePackedRgb(bits, i);
    else if (ctx.mode === "intensity" && r.attr) {
      const t = imax > imin ? (r.attr[i] - imin) / (imax - imin) : 0.5;
      const g = 0.15 + 0.85 * Math.min(1, Math.max(0, t));
      c = [g, g, g];
    } else c = PALETTE.base;
    out[3 * i] = c[0];
    out[3 * i + 1] = c[1];
    out[3 * i + 2] = c[2];
  }
  return out;
}
