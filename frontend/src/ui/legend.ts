import { PALETTE, type Rgb } from "../colour/palette";
import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import type { PreviewState } from "../state/types";
import { LEGEND_BOX } from "../view/layout";
import { control } from "./controls";
import { h } from "./dom";
import { iconSvg } from "./icons";

const LABEL = "Legend menu";

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

/**
 * The collapsible legend menu: a header button (aria-expanded, chevron) and a body holding the legend rows and the
 * mode line (`modebar`, id kept). `update(true)` adds the Step highlight row; a preview op adds its live-preview row.
 * Open by default; the folded state lives in `AppState.legendOpen` and is saved with the session.
 */
export function buildLegend(root: HTMLElement, store: Store<AppState>, modebar: HTMLElement): { update(stepActive: boolean, previewOp?: PreviewState["op"] | null): void } {
  let shown = false;
  let shownPreview: PreviewState["op"] | null = null;
  const rows = h("div", { class: "legend-rows" });
  const body = h("div", { id: "legend-body", "data-legend-body": "1" }, rows, modebar);
  const chev = iconSvg("chev", 14);
  const header = control("button", { id: "legend-menu", type: "button", class: "legend-head", "aria-label": LABEL, "aria-controls": "legend-body", "aria-expanded": "true" }, chev, h("span", { text: "Legend" }));
  header.addEventListener("click", () => store.update((s) => ({ ...s, legendOpen: !s.legendOpen })));
  root.style.left = `${LEGEND_BOX.left}px`;
  root.style.top = `${LEGEND_BOX.top}px`;
  root.style.width = `${LEGEND_BOX.w}px`;
  root.style.maxHeight = `${LEGEND_BOX.maxH}px`;
  root.append(header, body);
  const draw = () => {
    rows.replaceChildren();
    for (const e of legendEntries(shown, shownPreview)) {
      const chip = h("span", { class: "chip", "data-legend": e.id });
      chip.style.background = cssColour(e.colour);
      rows.append(h("span", { class: "legend-item" }, chip, e.label));
    }
  };
  const sync = (s: AppState) => {
    header.setAttribute("aria-expanded", String(s.legendOpen));
    header.classList.toggle("closed", !s.legendOpen);
    body.hidden = !s.legendOpen;
  };
  draw();
  store.subscribe(sync);
  sync(store.get());
  return {
    update(stepActive, previewOp = null) {
      if (stepActive === shown && previewOp === shownPreview) return;
      shown = stepActive;
      shownPreview = previewOp;
      draw();
    },
  };
}
