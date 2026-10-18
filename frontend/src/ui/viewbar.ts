import { type ColourMode, colourOptions } from "../colour/modes";
import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import { togglePerspective } from "../view/camera";
import { fitBounds } from "../view/fit";
import { parsePivot, resetPivot } from "../view/pivot";
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
  toggleHelp: () => void;
  notify: (text: string) => void;
  setCompare: (mode: CompareMode) => void;
}

export function buildViewbar(root: HTMLElement, store: Store<AppState>, a: ViewbarActions): void {
  const persp = control(
    "button",
    { id: "view-perspective", onclick: () => store.set({ camera: togglePerspective(store.get().camera) }) },
    "Perspective",
  );
  const fit = control(
    "button",
    {
      id: "fit-cloud",
      onclick: () => {
        const s = store.get();
        if (!s.session?.active_bounds) return;
        const { w, h } = a.size();
        store.set({ camera: fitBounds(s.camera, s.session.active_bounds, w / Math.max(h, 1)) });
      },
    },
    "Fit cloud",
  );
  const reset = control(
    "button",
    {
      id: "pivot-reset",
      onclick: () => {
        const s = store.get();
        store.set({ camera: resetPivot(s.camera, s.session?.active_bounds ?? null) });
      },
    },
    "Reset pivot",
  );
  const pick = control(
    "button",
    {
      id: "pivot-pick",
      onclick: () =>
        store.set({ interaction: store.get().interaction === "pick-pivot" ? "orbit" : "pick-pivot" }),
    },
    "Pick pivot",
  );
  const xyz = (axis: "x" | "y" | "z") =>
    control("input", { id: `pivot-${axis}`, type: "text", inputmode: "decimal", placeholder: axis.toUpperCase() });
  const [ix, iy, iz] = [xyz("x"), xyz("y"), xyz("z")];
  const set = control(
    "button",
    {
      id: "pivot-set",
      onclick: () => {
        const r = parsePivot([ix.value, iy.value, iz.value]);
        if (!r.ok) return a.notify(r.reason);
        store.set({ camera: { ...store.get().camera, target: r.point } });
      },
    },
    "Set pivot",
  );
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
  const help = iconControl("help", "help", { onclick: a.toggleHelp });

  root.append(
    persp,
    fit,
    h("span", { class: "sep" }),
    reset,
    pick,
    ix,
    iy,
    iz,
    set,
    h("span", { class: "sep" }),
    modeGroup,
    h("span", { class: "sep" }),
    h("label", {}, "Colour ", colour),
    h("label", {}, "Point size ", size),
    autoSize,
    h("label", {}, "Draw up to ", budget),
    help,
  );

  const fmt = (v: number) => String(Math.round(v * 1e6) / 1e6);
  const sync = (s: AppState) => {
    const t = s.camera.target;
    if (document.activeElement !== ix && document.activeElement !== iy && document.activeElement !== iz) {
      ix.value = fmt(t[0]);
      iy.value = fmt(t[1]);
      iz.value = fmt(t[2]);
    }
    persp.classList.toggle("active", !s.camera.ortho);
    pick.classList.toggle("active", s.interaction === "pick-pivot");
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
    for (const el of [persp, fit, reset, pick, set, ix, iy, iz, autoSize]) {
      (el as HTMLButtonElement).disabled = !has;
    }
    const opts = colourOptions(s.session?.schema ?? []);
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
