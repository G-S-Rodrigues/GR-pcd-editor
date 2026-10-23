import { type ColourMode, colourOptionsFor } from "../colour/modes";
import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import { AUTO_BUDGET, pointSizeFor, pxPerUnit } from "../view/pointsize";
import { dataModeModel } from "../compare/datamode";
import { COMPARE_MODES, type CompareMode, clampOpacity } from "../compare/model";
import { control } from "./controls";
import { h } from "./dom";

const BUDGETS = [100_000, 300_000, 1_000_000, AUTO_BUDGET];

export interface DisplayActions {
  size: () => { w: number; h: number };
  refresh: () => void;
}

export interface DataModeActions {
  setCompare: (mode: CompareMode) => void;
}

/** Colour, point size, Auto and the draw budget, as labelled rows of the Display popover. */
export function buildDisplayControls(root: HTMLElement, store: Store<AppState>, a: DisplayActions): void {
  const colour = control("select", {
    id: "colour-mode",
    onchange: () => {
      store.update((s) => ({ ...s, colour: { ...s.colour, mode: colour.value as ColourMode } }));
      a.refresh();
    },
  });
  const size = control("input", {
    id: "point-size",
    type: "range",
    min: "1",
    max: "10",
    step: "0.5",
    value: "3",
    oninput: () =>
      store.update((s) => ({ ...s, colour: { ...s.colour, pointSize: Number(size.value) } })),
  });
  const autoSize = control("button", {
    id: "point-size-auto",
    onclick: () => {
      const s = store.get();
      const px = pointSizeFor(pxPerUnit(s.camera, a.size().h));
      store.update((st) => ({ ...st, colour: { ...st.colour, pointSize: px } }));
    },
  }, "Auto");
  const budget = control("select", {
    id: "budget",
    onchange: () => {
      store.set({ budget: Number(budget.value) });
      a.refresh();
    },
  });
  for (const b of BUDGETS) {
    const label = b === AUTO_BUDGET ? "Auto (max)" : `${b.toLocaleString("en-US")} points`;
    budget.append(h("option", { value: String(b), selected: b === store.get().budget }, label));
  }
  const row = (label: string, ...kids: HTMLElement[]) => h("div", { class: "prow" }, h("span", { class: "plabel", text: label }), h("div", { class: "pctl" }, ...kids));
  root.append(row("Colour", colour), row("Point size", size, autoSize), row("Draw up to", budget));

  const sync = (s: AppState) => {
    const has = s.session !== null;
    autoSize.disabled = !has;
    const opts = colourOptionsFor(s.session?.schema ?? [], (s.session?.layers.length ?? 0) > 0);
    const key = opts.map((o) => `${o.id}${o.enabled}`).join();
    if (colour.dataset.key !== key) {
      colour.dataset.key = key;
      colour.replaceChildren(
        ...opts.map((o) =>
          h(
            "option",
            { value: o.id, disabled: !o.enabled, title: o.reason ?? "", selected: o.id === s.colour.mode },
            o.enabled ? o.label : `${o.label} (${o.reason})`,
          ),
        ),
      );
    }
    colour.disabled = !has;
    if (colour.value !== s.colour.mode && opts.some((o) => o.id === s.colour.mode)) colour.value = s.colour.mode;
    if (size.value !== String(s.colour.pointSize)) size.value = String(s.colour.pointSize);
    if (budget.value !== String(s.budget) && BUDGETS.includes(s.budget)) budget.value = String(s.budget);
  };
  store.subscribe(sync);
  sync(store.get());
}

/** The Data mode segmented control (text segments) and, in Overlay only, the opacity slider. */
export function buildDataMode(root: HTMLElement, store: Store<AppState>, a: DataModeActions): void {
  const names: Record<CompareMode, string> = { original: "Original", edited: "Edited", overlay: "Overlay", split: "Split" };
  const compareButtons = COMPARE_MODES.map((m) => control("button", { id: `compare-${m}`, type: "button", "aria-label": names[m], onclick: () => a.setCompare(m) }, names[m]));
  const modeGroup = h("div", { class: "seg mode-group", role: "group", "aria-label": "Data mode" });
  const opacity = control("input", {
    id: "overlay-opacity",
    type: "range",
    min: "0.05",
    max: "1",
    step: "0.05",
    value: "0.35",
    "aria-label": "Overlay opacity",
    oninput: () => store.set({ overlayOpacity: clampOpacity(Number(opacity.value)) }),
  });
  const opacityBox = h("span", { class: "opacity" }, opacity);
  root.append(modeGroup);

  const sync = (s: AppState) => {
    const dm = dataModeModel(s.compare, s.session !== null);
    for (const [i, it] of dm.items.entries()) {
      compareButtons[i].classList.toggle("active", it.pressed);
      compareButtons[i].setAttribute("aria-pressed", String(it.pressed));
      compareButtons[i].disabled = it.disabled;
    }
    if (modeGroup.dataset.opacity !== String(dm.showOpacity)) {
      modeGroup.dataset.opacity = String(dm.showOpacity);
      modeGroup.replaceChildren(...compareButtons, ...(dm.showOpacity ? [opacityBox] : []));
    }
    if (document.activeElement !== opacity) opacity.value = String(s.overlayOpacity);
  };
  store.subscribe(sync);
  sync(store.get());
}
