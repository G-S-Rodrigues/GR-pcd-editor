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
