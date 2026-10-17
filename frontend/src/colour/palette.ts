export type Rgb = readonly [number, number, number];

const hex = (h: number): Rgb => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

/** Single source of colours: base grey, selected-for-deletion, protected-selected, deleted overlay, pivot. */
export const PALETTE = {
  base: hex(0xb0b0b0),
  selected: hex(0xff9f1c),
  protected: hex(0x00d1ff),
  deleted: hex(0xe63946),
  pivot: hex(0xffffff),
} as const;

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
