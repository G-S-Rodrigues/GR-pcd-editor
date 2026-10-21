import type { Rgb } from "./palette";

/** Render attribute that carries one octahedral-packed normal (u32) per point; computed by the backend. */
export const NORMAL_ATTR = "@normal";

/** Inverse of the backend `oct_pack`: 16-bit u in the low half, 16-bit v in the high half, unit vector out. */
export function decodeNormal(word: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const u = (word & 0xffff) / 65535 * 2 - 1;
  const v = (word >>> 16) / 65535 * 2 - 1;
  const z = 1 - Math.abs(u) - Math.abs(v);
  let x = u;
  let y = v;
  if (z < 0) {
    x = (1 - Math.abs(v)) * (u >= 0 ? 1 : -1);
    y = (1 - Math.abs(u)) * (v >= 0 ? 1 : -1);
  }
  const len = Math.hypot(x, y, z) || 1;
  out[0] = x / len;
  out[1] = y / len;
  out[2] = z / len;
  return out;
}

/** Colour of a unit normal: each axis mapped from -1..1 to 0..1, so +X is reddish, +Y greenish and +Z bluish. */
export const normalColour = (n: readonly [number, number, number]): Rgb => [n[0] * 0.5 + 0.5, n[1] * 0.5 + 0.5, n[2] * 0.5 + 0.5];

/** The legend swatches of the mode: the colour of the +X, +Y and +Z normals. */
export function normalSwatches(): { label: string; colour: Rgb }[] {
  return [
    { label: "X", colour: normalColour([1, 0, 0]) },
    { label: "Y", colour: normalColour([0, 1, 0]) },
    { label: "Z", colour: normalColour([0, 0, 1]) },
  ];
}
