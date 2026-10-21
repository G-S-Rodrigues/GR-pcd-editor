import { PALETTE, type Rgb } from "./palette";

export type SelectedColourId = "orange" | "magenta" | "white" | "lime";

export interface SelectedPreset {
  id: SelectedColourId;
  label: string;
  colour: Rgb;
}

const hex = (h: number): Rgb => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

/** The colours the user can give selected points; the first is the default and equals PALETTE.selected. */
export const SELECTED_COLOURS: readonly SelectedPreset[] = [
  { id: "orange", label: "Orange", colour: PALETTE.selected },
  { id: "magenta", label: "Magenta", colour: hex(0xff00ff) },
  { id: "white", label: "White", colour: hex(0xffffff) },
  { id: "lime", label: "Lime", colour: hex(0x39ff14) },
];

export const DEFAULT_SELECTED: SelectedColourId = "orange";

export const isSelectedColourId = (v: unknown): v is SelectedColourId => SELECTED_COLOURS.some((p) => p.id === v);

export const selectedRgb = (id: SelectedColourId): Rgb => (SELECTED_COLOURS.find((p) => p.id === id) ?? SELECTED_COLOURS[0]).colour;
