import { LIGHT_PALETTE, PALETTE, type RenderTheme, type Rgb } from "./palette";

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

/** The same four ids in the same order for the light stage (R22-14); the White slot draws blue there (W1), so its label says so. */
export const LIGHT_SELECTED_COLOURS: readonly SelectedPreset[] = [
  { id: "orange", label: "Orange", colour: LIGHT_PALETTE.selected },
  { id: "magenta", label: "Magenta", colour: hex(0xed00ed) },
  { id: "white", label: "Blue", colour: hex(0x0000f0) },
  { id: "lime", label: "Lime", colour: hex(0x239c0c) },
];
export const selectedPresets = (theme: RenderTheme): readonly SelectedPreset[] => (theme === "light" ? LIGHT_SELECTED_COLOURS : SELECTED_COLOURS);

export const DEFAULT_SELECTED: SelectedColourId = "orange";

export const isSelectedColourId = (v: unknown): v is SelectedColourId => SELECTED_COLOURS.some((p) => p.id === v);

export const selectedRgb = (id: SelectedColourId, theme: RenderTheme = "dark"): Rgb => {
  const presets = selectedPresets(theme);
  return (presets.find((p) => p.id === id) ?? presets[0]).colour;
};
