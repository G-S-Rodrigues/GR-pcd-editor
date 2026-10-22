export type Rgb = readonly [number, number, number];

const hex = (h: number): Rgb => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

/** Single source of colours: base grey, selected-for-deletion, protected-selected, deleted overlay, pivot. */
export const PALETTE = {
  base: hex(0xb0b0b0),
  selected: hex(0xff9f1c),
  protected: hex(0x00d1ff),
  /** Points inside the protected slab while the protection section is open (brighter than `protected`). */
  protectedStrong: hex(0x00f0ff),
  slab: hex(0xc77dff),
  deleted: hex(0xe63946),
  /** Highlighted history step (its deleted points) and its lighter hover preview. */
  step: hex(0x7bd88f),
  stepHover: hex(0xcdeccf),
  pivot: hex(0xffffff),
  /** Pending Add/Subtract/Intersect preview: points that will be added / will be removed. */
  previewAdd: hex(0xff4fd8),
  previewRemove: hex(0x5b7cff),
} as const;

/** Which render palette is in force: set from the page's colour scheme (`state.renderTheme`), never saved. */
export type RenderTheme = "dark" | "light";
export type RenderPalette = Record<keyof typeof PALETTE, Rgb>;
/**
 * The light theme's point colours (R22-14, option A): each reads at 3:1 on the light stage (`--canvas` #e9ebef and `--canvas-vignette` #f6f7f9),
 * the highlighted step and its hover preview as composited at .95 and .7. `deleted` and `previewRemove` already pass and are unchanged.
 */
export const LIGHT_PALETTE: RenderPalette = {
  base: hex(0x878787),
  selected: hex(0xbe7715),
  protected: hex(0x0092be),
  protectedStrong: hex(0x00969f),
  slab: hex(0xab6bdb),
  deleted: hex(0xe63946),
  step: hex(0x528f5f),
  stepHover: hex(0x535f54),
  pivot: hex(0x1d1d1f),
  previewAdd: hex(0xe246bf),
  previewRemove: hex(0x5b7cff),
};
/** The palette for a render theme; the dark one is `PALETTE` itself. */
export const paletteFor = (theme: RenderTheme): RenderPalette => (theme === "light" ? LIGHT_PALETTE : PALETTE);

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/**
 * A colour as handed to three.js. three.js treats `color` attributes and `Color.setRGB` values as linear and sRGB-encodes the output, so a
 * palette float drawn as is comes out brighter than its hex. The light theme (R22-14) is exact: its hex is converted to linear here, so the
 * drawn pixel is the hex. The dark theme is passed through untouched (it draws as it always has).
 */
export const gpuRgb = (c: Rgb, theme: RenderTheme): Rgb => (theme === "light" ? [toLinear(c[0]), toLinear(c[1]), toLinear(c[2])] : c);
let gpuLight: RenderPalette | null = null;
/** `paletteFor`, as handed to three.js (see `gpuRgb`); the dark one is `PALETTE` itself. */
export const gpuPalette = (theme: RenderTheme): RenderPalette => {
  if (theme !== "light") return PALETTE;
  gpuLight ??= Object.fromEntries(Object.entries(LIGHT_PALETTE).map(([k, v]) => [k, gpuRgb(v, "light")])) as RenderPalette;
  return gpuLight;
};

export const DELETED_OPACITY_DEFAULT = 0.35;

export interface FaceColour {
  fill: string;
  text: string;
}
/** ViewCube face fills; label colour is whichever of white / near-black reads at >= 4.5:1 (white fails on five of the six fills). */
export const VIEWCUBE: Record<"top" | "bottom" | "front" | "back" | "left" | "right", FaceColour> = {
  top: { fill: "#4c78a8", text: "#ffffff" },
  bottom: { fill: "#9d755d", text: "#111111" },
  front: { fill: "#59a14f", text: "#111111" },
  back: { fill: "#b07aa1", text: "#111111" },
  left: { fill: "#f28e2b", text: "#111111" },
  right: { fill: "#e15759", text: "#111111" },
};

const rgb255 = (c: string): [number, number, number] => {
  const v = Number.parseInt(c.replace("#", ""), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const luminance = (c: string): number => {
  const [r, g, b] = rgb255(c).map((x) => {
    const u = x / 255;
    return u <= 0.03928 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** WCAG contrast ratio of two #rrggbb colours. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
export const rgbDistance = (a: string, b: string): number => {
  const [p, q] = [rgb255(a), rgb255(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};
