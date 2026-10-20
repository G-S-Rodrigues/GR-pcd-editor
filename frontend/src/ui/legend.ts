import { PALETTE, type Rgb } from "../colour/palette";
import { selectedRgb } from "../colour/selectcolour";
import { type RampLegend, cssGradient, rampLegend } from "../colour/ramps";
import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import type { PreviewState } from "../state/types";
import { HIDDEN_CHIP_TEXT, type LayerRow, hiddenPointCount, layerRows } from "../layers/model";
import { LEGEND_BOX } from "../view/layout";
import { control } from "./controls";
import { h } from "./dom";
import { iconSvg } from "./icons";

const LABEL = "Legend menu";

export interface LegendEntry {
  id: "base" | "selected" | "protected" | "slab" | "deleted" | "step" | "preview-add" | "preview-remove" | `layer-${number}`;
  label: string;
  colour: Rgb;
  /** Present on a layer row: which layer, whether it is drawn, and the eye button's label. */
  layer?: { id: number; visible: boolean; eyeLabel: string };
}

const hexRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as unknown as Rgb;

/** Legend rows; colours are the same constants the renderer uses. */
export function legendEntries(stepActive = false, previewOp: PreviewState["op"] | null = null, selected: Rgb = PALETTE.selected, layers: readonly LayerRow[] = []): LegendEntry[] {
  return [
    { id: "base", label: "Unselected", colour: PALETTE.base },
    { id: "selected", label: "Candidate (will delete)", colour: selected },
    { id: "protected", label: "Protected (kept)", colour: PALETTE.protected },
    { id: "slab", label: "Protection slab", colour: PALETTE.slab },
    { id: "deleted", label: "Deleted overlay", colour: PALETTE.deleted },
    ...(previewOp === "add" ? [{ id: "preview-add" as const, label: "Will be added", colour: PALETTE.previewAdd }] : []),
    ...(previewOp === "subtract" || previewOp === "intersect"
      ? [{ id: "preview-remove" as const, label: "Will be removed", colour: PALETTE.previewRemove }]
      : []),
    ...(stepActive ? [{ id: "step" as const, label: "Step highlight", colour: PALETTE.step }] : []),
    ...layers.map((l) => ({ id: `layer-${l.id}` as const, label: l.label, colour: hexRgb(l.colour), layer: { id: l.id, visible: l.visible, eyeLabel: l.eyeLabel } })),
  ];
}

export const cssColour = (c: Rgb): string => `rgb(${c.map((v) => Math.round(v * 255)).join(", ")})`;

/**
 * The collapsible legend menu: a header button (aria-expanded, chevron) and a body holding the legend rows and the
 * mode line (`modebar`, id kept). `update(true)` adds the Step highlight row; a preview op adds its live-preview row.
 * Open by default; the folded state lives in `AppState.legendOpen` and is saved with the session.
 */
export function buildLegend(root: HTMLElement, store: Store<AppState>, modebar: HTMLElement, onShowHidden: () => void = () => undefined, onToggleLayer: (id: number) => void = () => undefined): { update(stepActive: boolean, previewOp?: PreviewState["op"] | null): void } {
  let shown = false;
  let shownPreview: PreviewState["op"] | null = null;
  const rows = h("div", { class: "legend-rows" });
  // the colour key of the active mode (gradient + end labels); hidden in Grey
  const rampTitle = h("span", { class: "ramp-title" });
  const rampBar = h("div", { class: "ramp-bar", "data-ramp-bar": "1" });
  const rampMin = h("span", { class: "ramp-min" });
  const rampMax = h("span", { class: "ramp-max" });
  const rampEnds = h("div", { class: "ramp-ends" }, rampMin, rampMax);
  const rampSwatches = h("div", { class: "ramp-swatches", "data-ramp-swatches": "1", hidden: true });
  const ramp = h("div", { id: "legend-ramp", role: "img", hidden: true }, rampTitle, rampBar, rampEnds, rampSwatches);
  const layerBox = h("div", { class: "legend-layers" });
  const body = h("div", { id: "legend-body", "data-legend-body": "1" }, ramp, rows, layerBox, modebar);
  let current: RampLegend | null = null;
  let currentKey = "";
  const chev = iconSvg("chev", 14);
  const header = control("button", { id: "legend-menu", type: "button", class: "legend-head", "aria-label": LABEL, "aria-controls": "legend-body", "aria-expanded": "true" }, chev, h("span", { text: "Legend" }));
  header.addEventListener("click", () => store.update((s) => ({ ...s, legendOpen: !s.legendOpen })));
  root.style.left = `${LEGEND_BOX.left}px`;
  root.style.top = `${LEGEND_BOX.top}px`;
  root.style.width = `${LEGEND_BOX.w}px`;
  root.style.maxHeight = `${LEGEND_BOX.maxH}px`;
  // "N hidden - Show": the on-canvas reminder of "Hide selected"; inside the legend box, so no new reserved rectangle
  const chip = control("button", { id: "hidden-chip", type: "button", class: "hidden-chip", hidden: true, onclick: onShowHidden });
  root.append(header, chip, body);
  const draw = () => {
    rows.replaceChildren();
    for (const e of legendEntries(shown, shownPreview, selectedRgb(store.get().selectedColour))) {
      const chip = h("span", { class: "chip", "data-legend": e.id });
      chip.style.background = e.id === "base" && current ? cssGradient(current.stops) : cssColour(e.colour);
      rows.append(h("span", { class: "legend-item" }, chip, e.label));
    }
  };
  // layer rows, each with an eye toggle; rebuilt only when they change so a click is never swallowed
  let layersKey = "";
  const drawLayers = (s: AppState) => {
    const lr = layerRows(s.session);
    const key = JSON.stringify(lr);
    if (key === layersKey) return;
    layersKey = key;
    layerBox.replaceChildren(
      ...legendEntries(false, null, undefined, lr)
        .filter((e) => e.layer)
        .map((e) => {
          const chip = h("span", { class: "chip", "data-legend": e.id });
          chip.style.background = cssColour(e.colour);
          const eye = h("button", { type: "button", class: "legend-eye", "data-legend-eye": e.layer!.id, "aria-pressed": String(e.layer!.visible), "aria-label": e.layer!.eyeLabel, title: e.layer!.eyeLabel, onclick: () => onToggleLayer(e.layer!.id) }, iconSvg(e.layer!.visible ? "eye" : "eyeoff", 12));
          return h("span", { class: `legend-item${e.layer!.visible ? "" : " off"}`, "data-legend-layer": e.layer!.id }, chip, e.label, eye);
        }),
    );
  };
  const setHidden = (el: HTMLElement, hide: boolean) => (hide ? el.setAttribute("hidden", "") : el.removeAttribute("hidden"));
  const syncRamp = (s: AppState) => {
    const r = rampLegend(s.colour.mode, s.session?.active_bounds ?? null, s.session?.unit ?? "m");
    const key = r ? `${r.id}|${r.minLabel}|${r.maxLabel}` : "";
    if (key === currentKey) return;
    const rampChanged = (r?.id ?? null) !== (current?.id ?? null);
    currentKey = key;
    current = r;
    if (r) {
      rampTitle.textContent = r.title;
      rampBar.style.background = cssGradient(r.stops);
      rampMin.textContent = r.minLabel;
      rampMax.textContent = r.maxLabel;
      ramp.setAttribute("data-ramp", r.id);
      ramp.setAttribute("aria-label", r.swatches ? `${r.title}, ${r.swatches.map((x) => x.label).join(", ")} axis colours` : `${r.title}, ${r.minLabel} to ${r.maxLabel}`);
      setHidden(rampBar, !!r.swatches);
      setHidden(rampEnds, !!r.swatches);
      setHidden(rampSwatches, !r.swatches);
      rampSwatches.replaceChildren(
        ...(r.swatches ?? []).map((x) => {
          const chip = h("span", { class: "chip", "data-swatch": x.label });
          chip.style.background = cssColour(x.colour);
          return h("span", { class: "legend-item" }, chip, x.label);
        }),
      );
      ramp.removeAttribute("hidden");
    } else {
      ramp.removeAttribute("data-ramp");
      ramp.setAttribute("hidden", "");
    }
    if (rampChanged) draw();
  };
  let shownSelected = store.get().selectedColour;
  const sync = (s: AppState) => {
    syncRamp(s);
    drawLayers(s);
    if (s.selectedColour !== shownSelected) {
      shownSelected = s.selectedColour;
      draw();
    }
    header.setAttribute("aria-expanded", String(s.legendOpen));
    header.classList.toggle("closed", !s.legendOpen);
    body.hidden = !s.legendOpen;
    const nHidden = hiddenPointCount(s.session);
    chip.hidden = nHidden === 0;
    if (!chip.hidden) chip.textContent = HIDDEN_CHIP_TEXT(nHidden);
  };
  syncRamp(store.get());
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
