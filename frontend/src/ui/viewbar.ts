import { type ColourMode, colourOptionsFor } from "../colour/modes";
import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import { AUTO_BUDGET, pointSizeFor, pxPerUnit } from "../view/pointsize";
import { dataModeModel } from "../compare/datamode";
import { COMPARE_MODES, type CompareMode, clampOpacity } from "../compare/model";
import { control } from "./controls";
import { h } from "./dom";
import { iconControl } from "./iconbutton";

const BUDGETS = [100_000, 300_000, 1_000_000, AUTO_BUDGET];

export interface ViewbarActions {
  size: () => { w: number; h: number };
  refresh: () => void;
  setCompare: (mode: CompareMode) => void;
}

export function buildViewbar(root: HTMLElement, store: Store<AppState>, a: ViewbarActions): void {
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
  const modeIcon = Object.fromEntries(dataModeModel("edited", true).items.map((i) => [i.mode, i.icon])) as Record<CompareMode, ReturnType<typeof dataModeModel>["items"][number]["icon"]>;
  const compareButtons = COMPARE_MODES.map((m) => iconControl(`compare-${m}`, modeIcon[m], { onclick: () => a.setCompare(m) }));
  const modeGroup = h("div", { class: "mode-group", role: "group", "aria-label": "Data mode" });
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

  root.append(
    modeGroup,
    h("span", { class: "sep" }),
    h("label", {}, "Colour ", colour),
    h("label", {}, "Point size ", size),
    autoSize,
    h("label", {}, "Draw up to ", budget),
  );

  const sync = (s: AppState) => {
    const has = s.session !== null;
    const dm = dataModeModel(s.compare, has);
    for (const [i, it] of dm.items.entries()) {
      compareButtons[i].classList.toggle("active", it.pressed);
      compareButtons[i].setAttribute("aria-pressed", String(it.pressed));
      compareButtons[i].disabled = it.disabled;
    }
    if (modeGroup.dataset.opacity !== String(dm.showOpacity)) {
      modeGroup.dataset.opacity = String(dm.showOpacity);
      modeGroup.replaceChildren(...compareButtons, ...(dm.showOpacity ? [opacityBox] : []));
    }
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
    if (document.activeElement !== opacity) opacity.value = String(s.overlayOpacity);
  };
  store.subscribe(sync);
  sync(store.get());
}
