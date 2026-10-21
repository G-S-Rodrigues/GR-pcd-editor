import { type AppState } from "../state/app";
import type { Store } from "../state/store";
import { LAYER_COLOURS, MAIN_COLOUR, MAIN_LABEL, editingText, findLayer, layerButtons, layerRows } from "../layers/model";
import { control } from "./controls";
import { foldable } from "./fold";
import { h } from "./dom";
import { iconSvg } from "./icons";
import { TOOLTIPS } from "./tooltips";
import type { PanelActions } from "./panels";

/** The short note under the Layers heading; the long advice is its tooltip (part 17-10). */
export const LAYERS_NOTE = "Layer edits are timeline steps; Undo reverts them.";
export const LAYERS_NOTE_TITLE = "Named groups of points. Layer edits are timeline steps; Undo reverts them (names, colours, the eye and the flags are settings, not steps). Hidden layers are not drawn or selectable but are still exported.";

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
  const fromBandBtn = layerBtn("layer-from-band", "New layer from protected points", () => a.layerFromBand());
  const stack = h("div", { class: "stack" }, assignBtn, releaseBtn, setBtn);
  const editingLine = h("p", { id: "layer-editing", class: "note", hidden: true });
  const reasonOn = (b: HTMLElement, tipId: string, why: string | null) => {
    b.setAttribute("aria-disabled", String(why !== null));
    b.classList.toggle("inactive", why !== null);
    b.title = why ? `${TOOLTIPS[tipId]} (${why})` : TOOLTIPS[tipId];
  };
  const chipOf = (colour: string, extra = "") => {
    const c = h("span", { class: `chip${extra}` });
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
  let sessionId: string | null = null;
  const sync = (s: AppState) => {
    // a different file starts with every fold-out closed: layer ids repeat from file to file
    const sid = s.session?.session_id ?? null;
    if (sid !== sessionId) {
      sessionId = sid;
      opened.clear();
    }
    const rows = layerRows(s.session);
    const b = layerButtons(s);
    reasonOn(newBtn, "layer-new", b.create);
    reasonOn(assignBtn, "layer-assign", b.assign);
    reasonOn(releaseBtn, "layer-release", b.release);
    reasonOn(fromBandBtn, "layer-from-band", b.fromBand);
    const editing = findLayer(s.session, s.layerUi.editing ?? -1);
    setBtn.hidden = !editing;
    editingLine.hidden = !editing;
    editingLine.textContent = editing ? editingText(editing.name, editing.count, s.session?.selection.count ?? 0) : "";
    reasonOn(setBtn, "layer-set", b.set);
    for (const id of [...opened]) if (!rows.some((r) => r.id === id)) opened.delete(id);
    // rebuild the rows only when they change: a store update between mousedown and mouseup must not swallow a click
    const editingId = s.layerUi.editing;
    const key = JSON.stringify([rows, s.layerUi.active, s.session?.counts.main, [...opened], editingId]);
    if (key === layerKey) return;
    layerKey = key;
    const out: Node[] = [];
    if (rows.length > 0) {
      const main = MAIN_LABEL(s.session?.counts.main ?? 0);
      out.push(h("li", { class: "layer-row main", "data-layer-row": "0" }, chipOf(MAIN_COLOUR), ...nameAndCount("Main", main)));
    }
    for (const r of rows) {
      const open = opened.has(r.id) || editingId === r.id;
      const eye = h("button", { type: "button", class: "layer-eye", "data-layer-eye": r.id, "aria-pressed": String(r.visible), "aria-label": r.eyeLabel, title: r.eyeLabel, onclick: (e: Event) => (e.stopPropagation?.(), a.layerToggle(r.id)) }, iconSvg(r.visible ? "eye" : "eyeoff", 14));
      const selTitle = r.selectDisabled ?? `Select the ${r.count.toLocaleString("en-US")} points of ${r.name}`;
      const sel = h("button", { type: "button", class: `layer-icon${r.selectDisabled ? " inactive" : ""}`, "data-layer-select": r.id, "aria-disabled": String(r.selectDisabled !== null), "aria-label": `Select layer ${r.name}`, title: selTitle, onclick: (e: Event) => (e.stopPropagation?.(), a.layerSelect(r.id)) }, iconSvg("pick", 14));
      const more = h("button", { type: "button", class: "layer-icon layer-more", "data-layer-more": r.id, "aria-expanded": String(open), "aria-label": `More for layer ${r.name}`, title: `Options for ${r.name}`, onclick: (e: Event) => {
        e.stopPropagation?.();
        if (opened.has(r.id)) opened.delete(r.id);
        else opened.add(r.id);
        sync(store.get());
      } }, iconSvg("chev", 14));
      const stop = (e: Event) => e.stopPropagation?.();
      const btn = (attr: string, label: string, onclick: () => void, why: string | null = null, extra: Record<string, unknown> = {}) =>
        h("button", { type: "button", [`data-layer-${attr}`]: r.id, "aria-disabled": String(why !== null), class: `${why ? "inactive " : ""}${extra.class ?? ""}`.trim(), title: why ?? extra.title ?? label, onclick: (e: Event) => (stop(e), why === null && onclick()), ...(extra.aria ? { "aria-pressed": extra.aria } : {}) }, label);
      const flag = (attr: string, label: string, on: boolean, tip: string, onclick: () => void) => btn(attr, label, onclick, null, { aria: String(on), title: tip });
      const group = (cls: string, ...kids: Node[]) => h("div", { class: `layer-group ${cls}` }, ...kids);
      const commitRename = () => a.layerRename(r.id, rename.value);
      const rename = h("input", { type: "text", maxlength: "40", value: r.name, "data-layer-rename": r.id, "aria-label": `Rename ${r.name}`, title: `Rename ${r.name} (Enter)`, onclick: stop, onkeydown: (e: KeyboardEvent) => e.key === "Enter" && commitRename() });
      const swatches = LAYER_COLOURS.map((c, k) => {
        const sw = h("button", { type: "button", class: "layer-swatch", "data-layer-colour": r.id, "data-colour": k, "aria-pressed": String(k === r.colourIndex), "aria-label": `Colour ${k + 1}`, title: `Colour ${k + 1}`, onclick: (e: Event) => (stop(e), a.layerColour(r.id, k)) });
        sw.style.background = c;
        return sw;
      });
      const others = rows.filter((o) => o.id !== r.id);
      const mergeSel = h("select", { "data-layer-merge-target": r.id, "aria-label": `Merge ${r.name} into`, title: "The layer that receives the points", onclick: stop }, ...others.map((o) => h("option", { value: o.id, text: o.name })));
      mergeSel.value = String(others[0]?.id ?? "");
      const idx = rows.findIndex((o) => o.id === r.id);
      const op = (o: string, label: string, call: "replace" | "add" | "subtract" | "intersect", tip: string) =>
        h("button", { type: "button", "data-layer-op": o, "data-layer-of": r.id, title: tip, onclick: (e: Event) => (stop(e), a.layerOp(r.id, call)) }, label);
      const details = h(
        "li",
        { class: "layer-details", "data-layer-details": r.id, hidden: !open },
        group("g-rename", rename, btn("rename-ok", "Rename", commitRename, null, { title: `Rename ${r.name}` })),
        group("g-colour", ...swatches),
        group(
          "g-flags",
          flag("visible", "Visible", r.visible, `Show or hide ${r.name}`, () => a.layerToggle(r.id)),
          flag("protected", "Protected", r.protected, `Protected: the points of ${r.name} are never deleted by any Delete`, () => a.layerFlag(r.id, "protected", !r.protected)),
          flag("lock", "Lock", r.locked, `Lock: no points can be assigned into or out of ${r.name}; the points can still be deleted`, () => a.layerFlag(r.id, "locked", !r.locked)),
        ),
        group(
          "g-ops",
          op("select", "Select", "replace", `Select the points of ${r.name}`),
          op("add", "Add", "add", `Add the points of ${r.name} to the selection`),
          op("subtract", "Subtract", "subtract", `Remove the points of ${r.name} from the selection`),
          op("intersect", "Intersect", "intersect", `Keep only the selected points that are in ${r.name}`),
        ),
        group(
          "g-member",
          btn("edit", "Edit layer", () => a.layerEdit(r.id), r.editDisabled, { title: `Edit ${r.name}: select the layer's points again with a box, then press Set layer to selection` }),
          ...(editingId === r.id ? [setBtn] : []),
          btn("tomain", "To main", () => a.layerToMain(r.id), r.toMainDisabled, { title: `Move every point of ${r.name} back to main and remove the layer` }),
        ),
        group(
          "g-order",
          btn("up", "Up", () => a.layerMove(r.id, -1), idx === 0 ? "Already first" : null, { title: "Move up in the layer order" }),
          btn("down", "Down", () => a.layerMove(r.id, 1), idx === rows.length - 1 ? "Already last" : null, { title: "Move down in the layer order" }),
          mergeSel,
          btn("merge", "Merge", () => a.layerMerge(r.id, Number(mergeSel.value)), r.mergeDisabled, { title: `Merge ${r.name} into the chosen layer; ${r.name} goes away` }),
        ),
        group("g-delete", btn("delete-points", "Delete points", () => a.layerDeletePoints(r.id), r.deletePointsDisabled, { class: "danger", title: `Delete the points of ${r.name} (confirmed; a timeline step you can undo)` })),
      );
      out.push(
        h("li", { class: `layer-row${s.layerUi.active === r.id ? " active" : ""}`, "data-layer-row": r.id, title: r.title, "aria-selected": String(s.layerUi.active === r.id), onclick: () => a.layerChoose(r.id) }, chipOf(r.colour, `${r.protected ? " protected" : ""}${r.locked ? " locked" : ""}`), ...nameAndCount(r.name, r.label), eye, sel, more),
        details,
      );
    }
    layerList.replaceChildren(...out);
    stack.replaceChildren(assignBtn, releaseBtn, ...(rows.some((r) => r.id === editingId) ? [] : [setBtn]));
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
    h("div", { class: "stack" }, fromBandBtn),
    stack,
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
