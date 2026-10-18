import { PALETTE, type Rgb } from "../colour/palette";
import type { PreviewState } from "../state/types";
import { h } from "./dom";

export interface LegendEntry {
  id: "base" | "selected" | "protected" | "slab" | "deleted" | "step" | "preview-add" | "preview-remove";
  label: string;
  colour: Rgb;
}

/** Legend rows; colours are the same constants the renderer uses. */
export function legendEntries(stepActive = false, previewOp: PreviewState["op"] | null = null): LegendEntry[] {
  return [
    { id: "base", label: "Unselected", colour: PALETTE.base },
    { id: "selected", label: "Candidate (will delete)", colour: PALETTE.selected },
    { id: "protected", label: "Protected (kept)", colour: PALETTE.protected },
    { id: "slab", label: "Protection slab", colour: PALETTE.slab },
    { id: "deleted", label: "Deleted overlay", colour: PALETTE.deleted },
    ...(previewOp === "add" ? [{ id: "preview-add" as const, label: "Will be added", colour: PALETTE.previewAdd }] : []),
    ...(previewOp === "subtract" || previewOp === "intersect"
      ? [{ id: "preview-remove" as const, label: "Will be removed", colour: PALETTE.previewRemove }]
      : []),
    ...(stepActive ? [{ id: "step" as const, label: "Step highlight", colour: PALETTE.step }] : []),
  ];
}

export const cssColour = (c: Rgb): string => `rgb(${c.map((v) => Math.round(v * 255)).join(", ")})`;

/** Builds the rows; `update(true)` adds the Step highlight row (only while a history step is highlighted). */
export function buildLegend(root: HTMLElement): { update(stepActive: boolean, previewOp?: PreviewState["op"] | null): void } {
  let shown = false;
  let shownPreview: PreviewState["op"] | null = null;
  const draw = () => {
    root.replaceChildren();
    for (const e of legendEntries(shown, shownPreview)) {
      const chip = h("span", { class: "chip", "data-legend": e.id });
      chip.style.background = cssColour(e.colour);
      root.append(h("span", { class: "legend-item" }, chip, e.label));
    }
  };
  draw();
  return {
    update(stepActive, previewOp = null) {
      if (stepActive === shown && previewOp === shownPreview) return;
      shown = stepActive;
      shownPreview = previewOp;
      draw();
    },
  };
}
