import { type AppState } from "../state/app";
import type { Store } from "../state/store";
import { MAIN_COLOUR, MAIN_LABEL, editingText, findLayer, layerButtons, layerRows } from "../layers/model";
import { control } from "./controls";
import { foldable } from "./fold";
import { h } from "./dom";
import { iconSvg } from "./icons";
import { TOOLTIPS } from "./tooltips";
import type { PanelActions } from "./panels";

/** The short note under the Layers heading; the long advice is its tooltip (part 17-10). */
export const LAYERS_NOTE = "Layer edits are not in the timeline.";
export const LAYERS_NOTE_TITLE = "Named groups of points. Layer edits are not in the timeline; undo one by re-assigning the points. Hidden layers are not drawn or selectable but are still exported.";

/**
 * The Layers section of the left panel (moved out of the right panel in part 17-10). A layer row is one line: colour chip, name,
 * count, eye, Select and a chevron that opens the row's details area. Edit layer and To main live in that area, which is also
 * where Part 18's per-layer edit menu goes.
 */
export function buildLayersPanel(root: HTMLElement, store: Store<AppState>, a: PanelActions): void {
  const syncs: ((s: AppState) => void)[] = [];
  const layerList = h("ul", { id: "layer-list", class: "layer-list" });
  const layerName = control("input", { id: "layer-name", type: "text", maxlength: "40", placeholder: "Layer name", "aria-label": "Layer name" });
  const layerBtn = (id: string, label: string, onclick: () => void) => control("button", { id, "aria-disabled": "false", onclick }, label);
  const newBtn = layerBtn("layer-new", "New layer", () => {
    a.layerCreate(layerName.value);
    layerName.value = "";
  });
  const assignBtn = layerBtn("layer-assign", "Assign selection", () => a.layerAssign());
  const releaseBtn = layerBtn("layer-release", "Release to main", () => a.layerRelease());
  const setBtn = layerBtn("layer-set", "Set layer to selection", () => a.layerSet());
  setBtn.hidden = true;
  const editingLine = h("p", { id: "layer-editing", class: "note", hidden: true });
  const reasonOn = (b: HTMLElement, tipId: string, why: string | null) => {
    b.setAttribute("aria-disabled", String(why !== null));
    b.classList.toggle("inactive", why !== null);
    b.title = why ? `${TOOLTIPS[tipId]} (${why})` : TOOLTIPS[tipId];
  };
  const chipOf = (colour: string) => {
    const c = h("span", { class: "chip" });
    c.style.background = colour;
    return c;
  };
  /** The label is "Name (count)": the name takes the room and the count is the muted tail. */
  const nameAndCount = (name: string, label: string): Node[] => [
    h("span", { class: "layer-name", text: name }),
    h("span", { class: "layer-count", text: label.startsWith(name) ? label.slice(name.length) : "" }),
  ];
  const opened = new Set<number>();
  let layerKey = "";
  const sync = (s: AppState) => {
    const rows = layerRows(s.session);
    const b = layerButtons(s);
    reasonOn(newBtn, "layer-new", b.create);
    reasonOn(assignBtn, "layer-assign", b.assign);
    reasonOn(releaseBtn, "layer-release", b.release);
    const editing = findLayer(s.session, s.layerUi.editing ?? -1);
    setBtn.hidden = !editing;
    editingLine.hidden = !editing;
    editingLine.textContent = editing ? editingText(editing.name, editing.count, s.session?.selection.count ?? 0) : "";
    reasonOn(setBtn, "layer-set", b.set);
    for (const id of [...opened]) if (!rows.some((r) => r.id === id)) opened.delete(id);
    // rebuild the rows only when they change: a store update between mousedown and mouseup must not swallow a click
    const key = JSON.stringify([rows, s.layerUi.active, s.session?.counts.main, [...opened]]);
    if (key === layerKey) return;
    layerKey = key;
    const out: Node[] = [];
    if (rows.length > 0) {
      const main = MAIN_LABEL(s.session?.counts.main ?? 0);
      out.push(h("li", { class: "layer-row main", "data-layer-row": "0" }, chipOf(MAIN_COLOUR), ...nameAndCount("Main", main)));
    }
    for (const r of rows) {
      const open = opened.has(r.id);
      const eye = h("button", { type: "button", class: "layer-eye", "data-layer-eye": r.id, "aria-pressed": String(r.visible), "aria-label": r.eyeLabel, title: r.eyeLabel, onclick: (e: Event) => (e.stopPropagation?.(), a.layerToggle(r.id)) }, iconSvg(r.visible ? "eye" : "eyeoff", 14));
      const selTitle = r.selectDisabled ?? `Select the ${r.count.toLocaleString("en-US")} points of ${r.name}`;
      const sel = h("button", { type: "button", class: `layer-icon${r.selectDisabled ? " inactive" : ""}`, "data-layer-select": r.id, "aria-disabled": String(r.selectDisabled !== null), "aria-label": `Select layer ${r.name}`, title: selTitle, onclick: (e: Event) => (e.stopPropagation?.(), a.layerSelect(r.id)) }, iconSvg("pick", 14));
      const more = h("button", { type: "button", class: "layer-icon layer-more", "data-layer-more": r.id, "aria-expanded": String(open), "aria-label": `More for layer ${r.name}`, title: `More for ${r.name}: Edit layer, To main`, onclick: (e: Event) => {
        e.stopPropagation?.();
        if (opened.has(r.id)) opened.delete(r.id);
        else opened.add(r.id);
        sync(store.get());
      } }, iconSvg("chev", 14));
      const edit = h("button", { type: "button", "data-layer-edit": r.id, "aria-disabled": String(r.editDisabled !== null), class: r.editDisabled ? "inactive" : "", title: r.editDisabled ?? `Edit ${r.name}: select the layer's points again with a box, then press Set layer to selection`, onclick: (e: Event) => (e.stopPropagation?.(), a.layerEdit(r.id)) }, "Edit layer");
      const tomain = h("button", { type: "button", "data-layer-tomain": r.id, title: `Move every point of ${r.name} back to main and remove the layer`, onclick: (e: Event) => (e.stopPropagation?.(), a.layerToMain(r.id)) }, "To main");
      out.push(
        h("li", { class: `layer-row${s.layerUi.active === r.id ? " active" : ""}`, "data-layer-row": r.id, "aria-selected": String(s.layerUi.active === r.id), onclick: () => a.layerChoose(r.id) }, chipOf(r.colour), ...nameAndCount(r.name, r.label), eye, sel, more),
        h("li", { class: "layer-details", "data-layer-details": r.id, hidden: !open }, edit, tomain),
      );
    }
    layerList.replaceChildren(...out);
  };
  syncs.push(sync);
  const empty = h("p", { class: "note" });
  syncs.push((s) => (empty.textContent = s.session && s.session.layers.length === 0 ? "No layers yet: select points, type a name, then press New layer" : ""));
  const f = foldable(
    store,
    "layers",
    h("h2", { text: "Layers" }),
    h("p", { class: "note", title: LAYERS_NOTE_TITLE, text: LAYERS_NOTE }),
    empty,
    layerList,
    editingLine,
    h("div", { class: "oprow" }, layerName, newBtn),
    h("div", { class: "stack" }, assignBtn, releaseBtn, setBtn),
  );
  syncs.push((s) => {
    f.el.hidden = s.session === null;
    f.sync(s);
  });
  root.append(f.el);
  const syncAll = (s: AppState) => {
    for (const x of syncs) x(s);
  };
  store.subscribe(syncAll);
  syncAll(store.get());
}
