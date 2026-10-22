import type { AttrArray } from "../render/parse";
import { LAYER_COLOURS } from "../layers/model";
import type { Bounds, FieldInfo, Layer, Vec3 } from "../state/types";
import { type Tilt, slabCoordinate } from "../inspector/tilt";
import { PALETTE, type RenderPalette, type Rgb } from "./palette";
import { NORMAL_ATTR, decodeNormal, normalColour } from "./normals";
import { RAMP_STOPS, rampAt } from "./ramps";

export type ColourMode = "turbo" | "viridis" | "flat" | "distance" | "normals" | "layers";

export interface ColourOption {
  id: ColourMode;
  label: string;
  enabled: boolean;
  reason?: string;
  /** Render attribute this mode needs (only Normal shading: the computed @normal). */
  attr?: string;
}

/** The colour modes; every one works on any file, so the schema does not matter. */
export function colourOptions(_schema: FieldInfo[]): ColourOption[] {
  return [
    { id: "turbo", label: "Height (Turbo)", enabled: true },
    { id: "viridis", label: "Height (Viridis)", enabled: true },
    { id: "flat", label: "Grey", enabled: true },
    { id: "distance", label: "Distance to viewer", enabled: true },
    { id: "normals", label: "Normal shading", enabled: true, attr: NORMAL_ATTR },
  ];
}

/** The five modes, plus Layers when the session has layers (a layer-less session never offers it). */
export function colourOptionsFor(schema: FieldInfo[], hasLayers: boolean): ColourOption[] {
  return [...colourOptions(schema), ...(hasLayers ? [{ id: "layers" as const, label: "Layers", enabled: true }] : [])];
}

const hexRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as unknown as Rgb;
const LAYER_RGB: readonly Rgb[] = LAYER_COLOURS.map(hexRgb);

/** Colour per layer id (index 0..255; main and unknown ids are undefined and draw in the base grey). */
export function layerPaletteRgb(layers: readonly Layer[]): (Rgb | undefined)[] {
  const out: (Rgb | undefined)[] = new Array(256).fill(undefined);
  for (const l of layers) out[l.id] = LAYER_RGB[((l.colour % 16) + 16) % 16];
  return out;
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
  /** Layer id per point (0 = main); used by the Layers mode only. */
  layer?: Uint8Array;
}
export interface ColourContext {
  mode: ColourMode;
  bounds: Bounds | null;
  markDeleted: boolean;
  /** Colour per layer id for the Layers mode (see `layerPaletteRgb`). */
  layerRgb?: readonly (Rgb | undefined)[];
  /** Colour of selected (candidate) points; default the palette's `selected`. */
  selected?: Rgb;
  /** The point palette (`paletteFor(renderTheme)`); default the dark `PALETTE`. */
  palette?: RenderPalette;
  /** Protected slab intervals (Z, file frame) to draw strong; absent when the protection section is collapsed. */
  region?: { intervals: { min: number; max: number }[]; tilt?: Tilt } | null;
}

/** Per-point RGB (float 0..1); selection/protection/deleted flags override the base colour. */
export function colourize(r: ColourInput, ctx: ColourContext): Float32Array {
  return colourizeMasked(r, ctx).colours;
}

/**
 * `colours` as `colourize`; `ovr` is 1 for each point whose colour is a flag, protected or region colour and 0 for the
 * points the mode colours itself (a layer point in Layers mode draws its layer colour before the slab colour, R22-3). The Distance
 * shader recolours only the 0 points (the camera decides their colour).
 */
export function colourizeMasked(r: ColourInput, ctx: ColourContext): { colours: Float32Array; ovr: Float32Array } {
  const P = ctx.palette ?? PALETTE;
  const out = new Float32Array(r.count * 3);
  const ovr = new Float32Array(r.count);
  const lo = ctx.bounds ? ctx.bounds.min[2] : 0;
  const hi = ctx.bounds ? ctx.bounds.max[2] : 0;
  const stops = ctx.mode === "turbo" ? RAMP_STOPS.turbo : ctx.mode === "viridis" ? RAMP_STOPS.viridis : null;
  const nrm = ctx.mode === "normals" && r.attr && r.attrKind === "u32" ? (r.attr as Uint32Array) : null;
  const lay = ctx.mode === "layers" && r.layer && ctx.layerRgb ? r.layer : null;
  const tmp: [number, number, number] = [0, 0, 0];
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
    ovr[i] = 1;
    if (f & 2) c = region ? P.protectedStrong : P.protected;
    else if (f & 8) c = P.previewAdd;
    else if (f & 16) c = P.previewRemove;
    else if (f & 1) c = ctx.selected ?? P.selected;
    else if (f & 4 && ctx.markDeleted) c = P.deleted;
    else if (lay && ctx.layerRgb![lay[i]] !== undefined) {
      ovr[i] = 0;
      c = ctx.layerRgb![lay[i]]!; // R22-3: a layer's colour wins over the slab colour, protected or not
    }
    else if (region && inRegion(i)) c = P.protectedStrong;
    else {
      ovr[i] = 0;
      c = stops ? heightRamp(r.coords[3 * i + 2] + r.origin[2], lo, hi, stops) : nrm ? normalColour(decodeNormal(nrm[i], tmp)) : P.base;
    }
    out[3 * i] = c[0];
    out[3 * i + 1] = c[1];
    out[3 * i + 2] = c[2];
  }
  return { colours: out, ovr };
}
