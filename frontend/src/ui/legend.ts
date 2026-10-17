import { PALETTE, type Rgb } from "../colour/palette";
import { h } from "./dom";

export interface LegendEntry {
  id: "base" | "selected" | "protected" | "slab" | "deleted";
  label: string;
  colour: Rgb;
}

/** Legend rows; colours are the same constants the renderer uses. */
export function legendEntries(): LegendEntry[] {
  return [
    { id: "base", label: "Unselected", colour: PALETTE.base },
    { id: "selected", label: "Candidate (will delete)", colour: PALETTE.selected },
    { id: "protected", label: "Protected (kept)", colour: PALETTE.protected },
    { id: "slab", label: "Protection slab", colour: PALETTE.slab },
    { id: "deleted", label: "Deleted overlay", colour: PALETTE.deleted },
  ];
}

export const cssColour = (c: Rgb): string => `rgb(${c.map((v) => Math.round(v * 255)).join(", ")})`;

export function buildLegend(root: HTMLElement): void {
  for (const e of legendEntries()) {
    const chip = h("span", { class: "chip", "data-legend": e.id });
    chip.style.background = cssColour(e.colour);
    root.append(h("span", { class: "legend-item" }, chip, e.label));
  }
}
