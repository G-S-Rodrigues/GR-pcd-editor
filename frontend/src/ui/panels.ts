import { PROTECTION_COPY, effectiveText, retainedText } from "../inspector/protection";
import * as P from "../inspector/protection";
import { FILTER_COPY, filterSummary } from "../inspector/filters";
import { type AppState, addNotice } from "../state/app";
import { deleteBlockedNote } from "../orchestration/runner";
import type { Store } from "../state/store";
import type { Vec3 } from "../state/types";
import * as B from "../tools/box/model";
import { displayedBounds, fitToView, rectAxis, rectDepth } from "../tools/box/rect";
import { POLYGON_DEPTH_NOTE, Z_UNLIMITED } from "../tools/polygon/model";
import * as PG from "../tools/polygon/model";
import { polygonHint } from "../tools/polygon/edit";
import { CLUSTER_LIMIT_TEXT, type RegionKind, clusterLimitText, clusterPanel, regionOptions, setRadius } from "../tools/cluster/model";
import { type SparseModel, setMinNeighbours, setSparseRadius, sparseSummary } from "../tools/sparse/model";
import { type PlaneModel, planeRows, planeSummary, setMaxPlanes, setMaxTilt, setPlaneDistance } from "../tools/plane/model";
import { type ThinModel, setThinDistance, setThinEdge, setThinMethod, thinSummary } from "../tools/thin/model";
import { planesNote } from "../orchestration/planes";
import { clusterPickState, pickText, pressPick } from "../tools/cluster/pick";
import { headline } from "../status/headline";
import { commitEnabled, commitLabel, discardEnabled, previewClusterOf, previewParts } from "../tools/preview";
import { scopeNotice, selectionDisabledReason } from "../orchestration/selection";
import { hideState } from "../orchestration/hide";
import { control } from "./controls";
import { SELECTED_COLOURS, type SelectedColourId, selectedPresets } from "../colour/selectcolour";
import { cssColour } from "./legend";
import { iconControl } from "./iconbutton";
import { type IconName, iconSvg } from "./icons";
import type { PopEntry } from "./popover";
import { BOX_NOTE, CLUSTER_HELP, PLANE_HELP, SPARSE_HELP, THIN_HELP } from "./copy";
import { commitNumber } from "./numfield";
import { TOOLTIPS } from "./tooltips";
import { h } from "./dom";
import { foldSyncer, foldable } from "./fold";
import { type SectionId, isSectionOpen, setSectionOpen } from "./sections";

/** The first-selection note: the short line is visible, the advice is its tooltip (part 17-10). */
export const LIVE_NOTE = "First selection: edits are live.";
export const LIVE_NOTE_TITLE = "First selection: edits are live. Choose Add, Subtract or Intersect to preview changes instead.";

/** What the panels need from the rest of the app. */
export { BOX_NOTE } from "./copy";

export interface PanelActions {
  toolChanged: () => void;
  scopeChanged: () => void;
  filterResetAll: () => void;
  protectionEdit: (fn: (m: P.ProtectionModel) => P.ProtectionEdit) => P.ProtectionEdit;
  setTool: (t: AppState["tool"]) => void;
  commitDraft: () => void;
  discardDraft: () => void;
  selectDisplayed: () => void;
  invert: () => void;
  clearSelection: () => void;
  toggleHide: () => void;
  layerCreate: (name: string) => void;
  layerAssign: () => void;
  layerRelease: () => void;
  layerSelect: (id: number) => void;
  layerToggle: (id: number) => void;
  layerToMain: (id: number) => void;
  layerChoose: (id: number) => void;
  layerEdit: (id: number) => void;
  layerSet: () => void;
  layerFromBand: () => void;
  layerRename: (id: number, name: string) => void;
  layerColour: (id: number, colour: number) => void;
  layerFlag: (id: number, flag: "protected" | "locked", value: boolean) => void;
  layerOp: (id: number, op: "replace" | "add" | "subtract" | "intersect") => void;
  layerMove: (id: number, dir: -1 | 1) => void;
  layerMerge: (from: number, into: number) => void;
  layerDeletePoints: (id: number) => void;
  cancelJob: () => void;
  planeDetect: () => void;
  planeCancel: () => void;
  planeSelect: (index: number) => void;
  planeBand: (index: number) => void;
  startDrawing: () => void;
  finishPolygon: () => string | null;
  cancelDrawing: () => void;
  clearPolygon: () => void;
  viewSize: () => { w: number; h: number };
}

const RECT_REASON = "switch to an ortho view (click a ViewCube face)";
type Sync = (s: AppState) => void;
const fmt = (v: number) => String(Math.round(v * 1e6) / 1e6);

export function buildToolPalette(root: HTMLElement, store: Store<AppState>, a: PanelActions): void {
  // Operation: three icon radios (none pressed while the first selection is live). Replace is not offered.
  const OPS = [
    ["add", "op-add", "add"],
    ["subtract", "op-subtract", "sub"],
    ["intersect", "op-intersect", "int"],
  ] as const;
  const chooseOp = (value: AppState["op"]) => {
    // choosing an operation ends the first (live) selection: the next edit previews against the selection
    store.set({ op: value, liveFirst: false });
    const s = store.get();
    // with a draft showing, a new operation re-previews that shape
    if ((s.draft || s.preview) && s.tool !== "none") a.toolChanged();
  };
  const opBtns = OPS.map(([value, id, icon], i) => {
    const b = iconControl(id, icon, {
      role: "radio",
      onclick: () => chooseOp(value),
      onkeydown: (e: KeyboardEvent) => {
        const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        const j = (i + d + OPS.length) % OPS.length;
        chooseOp(OPS[j][0]);
        opBtns[j].focus();
      },
    });
    return b;
  });
  const op = control("div", { id: "op-select", role: "radiogroup", "aria-label": "Operation", class: "opgroup" }, ...opBtns);
  const previewLive = control(
    "button",
    {
      id: "preview-live",
      role: "switch",
      class: "toggle",
      onclick: () => {
        store.set({ previewLive: !store.get().previewLive });
        const s = store.get();
        if (s.draft && s.tool !== "none") a.toolChanged(); // turning it on previews the shape now; off drops the old preview
      },
    },
    iconSvg("eye", 16),
    " Live preview",
  );
  const liveNote = h("p", { id: "live-note", class: "note", hidden: true });
  const scope = control(
    "select",
    {
      id: "scope-select",
      onchange: () => {
        store.set({ scope: scope.value as AppState["scope"] });
        a.scopeChanged();
      },
    },
    h("option", { value: "displayed", text: "Displayed" }),
    h("option", { value: "active", text: "Active" }),
  );
  // Selected colour: four swatch radios (Orange default); view-only, saved with the session when not orange
  const chooseColour = (id: SelectedColourId) => store.set({ selectedColour: id });
  const swatches = SELECTED_COLOURS.map((p, i) => {
    const b = control(
      "button",
      {
        id: `sel-colour-${p.id}`,
        type: "button",
        role: "radio",
        class: "swatch",
        "aria-label": `Selected colour ${p.label}`,
        onclick: () => chooseColour(p.id),
        onkeydown: (e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            chooseColour(p.id);
            return;
          }
          const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
          if (!d) return;
          e.preventDefault();
          const j = (i + d + SELECTED_COLOURS.length) % SELECTED_COLOURS.length;
          chooseColour(SELECTED_COLOURS[j].id);
          swatches[j].focus();
        },
      },
    );
    b.style.background = cssColour(p.colour);
    return b;
  });
  const swatchGroup = control("div", { id: "sel-colour", role: "radiogroup", "aria-label": "Selected colour", class: "opgroup" }, ...swatches);
  // Select displayed and Invert stay clickable but inactive (aria-disabled) while a tool is armed: the click explains why
  const guardedBtns: HTMLButtonElement[] = [];
  const guarded = (b: HTMLButtonElement) => (guardedBtns.push(b), b);
  const refuse = (): boolean => {
    const why = selectionDisabledReason(store.get());
    if (why) addNotice(store, "warn", "selection_disabled", why);
    return why !== null;
  };
  // Hide selected: a text button (no glyph); inactive buttons stay clickable so the click explains why (like Select displayed)
  const hideBtn = control("button", { id: "sel-hide", "aria-pressed": "false", onclick: () => a.toggleHide() }, "Hide selected");
  const commit = control("button", { id: "sel-commit", onclick: a.commitDraft }, "Commit draft");
  const discard = control("button", { id: "sel-discard", onclick: a.discardDraft }, "Discard draft");
  const note = h("p", { id: "scope-note", class: "note" });
  const deleteBlocked = h("p", { id: "delete-blocked", class: "note warn", hidden: true });
  const clusterLimit = h("p", { id: "cluster-limit", class: "note warn", hidden: true });
  const draftNote = h("p", { id: "draft-note", class: "note warn", hidden: true });
  const keptWarn = h("p", { id: "kept-warning", class: "note warn", hidden: true });
  const keptDelete = control(
    "button",
    { id: "sel-delete-kept", onclick: () => showKeptErr(a.protectionEdit((m) => P.alsoDeleteKept(m, store.get().session?.bounds ?? null)).error) },
    "Also delete the kept points",
  );
  const showKeptErr = (m: string | null | undefined) => {
    if (m) addNotice(store, "error", "delete_kept_failed", m);
  };
  const keptToggle = control("button", { id: "sel-show-kept", onclick: () => store.update((s) => ({ ...s, showKept: !s.showKept })) }, "Show kept points");
  root.append(
    h("h2", { text: "Selection" }),
    h("div", { class: "oprow" }, h("span", { text: "Operation" }), op, previewLive),
    liveNote,
    h("div", { class: "oprow scoperow" }, h("label", { text: "Scope" }), scope),
    h("div", { class: "oprow" }, h("span", { text: "Selected colour" }), swatchGroup),
    h("div", { class: "stack" }, commit, discard),
    h(
      "div",
      { class: "stack" },
      guarded(control("button", { id: "sel-select-displayed", onclick: () => refuse() || a.selectDisplayed() }, "Select displayed")),
      guarded(control("button", { id: "sel-invert", onclick: () => refuse() || a.invert() }, "Invert")),
    ),
    h("div", { class: "stack" }, control("button", { id: "sel-clear", onclick: a.clearSelection }, "Clear selection"), hideBtn),
    deleteBlocked,
    note,
    clusterLimit,
    draftNote,
    keptWarn,
    keptDelete,
    keptToggle,
    h("div", { id: "layers-slot" }),
  );
  const sync: Sync = (s) => {
    const open = s.session !== null;
    const ro = s.compare !== "edited";
    OPS.forEach(([value], i) => {
      const on = !s.liveFirst && s.op === value;
      opBtns[i].setAttribute("aria-checked", String(on));
      opBtns[i].tabIndex = on || (s.liveFirst && i === 0) ? 0 : -1;
      opBtns[i].disabled = !open || ro;
    });
    previewLive.setAttribute("aria-checked", String(s.previewLive));
    previewLive.setAttribute("aria-pressed", String(s.previewLive));
    previewLive.replaceChildren(iconSvg(s.previewLive ? "eye" : "eyeoff", 16), " Live preview");
    liveNote.hidden = !(s.liveFirst && s.tool !== "none");
    liveNote.textContent = liveNote.hidden ? "" : LIVE_NOTE;
    liveNote.title = liveNote.hidden ? "" : LIVE_NOTE_TITLE;
    scope.value = s.scope;
    const presets = selectedPresets(s.renderTheme);
    SELECTED_COLOURS.forEach((p, i) => {
      const on = s.selectedColour === p.id;
      // the dot follows the render theme (the White slot is Blue on the light stage): same element, so focus is kept
      swatches[i].style.background = cssColour(presets[i].colour);
      swatches[i].setAttribute("aria-label", `Selected colour ${presets[i].label}`);
      swatches[i].setAttribute("aria-checked", String(on));
      swatches[i].tabIndex = on ? 0 : -1;
      swatches[i].disabled = !open;
    });
    const why = selectionDisabledReason(s);
    for (const b of guardedBtns) {
      const id = b.getAttribute("data-control") ?? "";
      b.setAttribute("aria-disabled", String(why !== null));
      b.classList.toggle("inactive", why !== null);
      b.title = why ? `${TOOLTIPS[id]} (${why})` : (TOOLTIPS[id] ?? "");
    }
    const hs = hideState(s);
    hideBtn.textContent = hs.label;
    hideBtn.setAttribute("aria-pressed", String(hs.pressed));
    hideBtn.setAttribute("aria-disabled", String(hs.reason !== null));
    hideBtn.classList.toggle("inactive", hs.reason !== null);
    hideBtn.title = hs.reason ? `${TOOLTIPS["sel-hide"]} (${hs.reason})` : TOOLTIPS["sel-hide"];
    commit.disabled = !commitEnabled(s);
    commit.textContent = commitLabel(s);
    discard.disabled = !discardEnabled(s);
    const dn = previewParts(s);
    draftNote.hidden = dn === null;
    draftNote.textContent = dn?.text ?? "";
    draftNote.title = dn?.title ?? "";
    const n = scopeNotice(s);
    note.textContent = n ?? "";
    const db = deleteBlockedNote(s);
    deleteBlocked.hidden = db === null;
    deleteBlocked.textContent = db ?? "";
    const lim = clusterLimitText(previewClusterOf(s));
    clusterLimit.hidden = lim === null;
    clusterLimit.textContent = lim ?? "";
    const hl = headline(s);
    keptWarn.hidden = hl.warning === null;
    keptWarn.textContent = hl.warning ?? "";
    keptDelete.hidden = hl.deleteKeptLabel === null;
    keptDelete.textContent = hl.deleteKeptLabel ?? "";
    keptToggle.hidden = hl.keptCount === 0;
    keptToggle.classList.toggle("active", s.showKept);
  };
  store.subscribe(sync);
  sync(store.get());
}

/** Where `buildEditPanels` puts the four tool sections and what it scrolls to the top when a tool is armed. */
export interface EditPanelSlots {
  /** The fixed slot above File: the armed tool's section is its only visible child. Defaults to `root`. */
  toolRoot?: HTMLElement;
  /** The scrolling panel (the inspector); its `scrollTop` is set to 0 once per arming. */
  scroller?: { scrollTop: number };
  /** The popover manager: the `?` helps register through it, so the one-open and Esc rules cover them (22-6). */
  pops?: { add(e: PopEntry): void; close(): void };
  /** The document-level popover container the help panels hang off (a folded `details` does not render its body). */
  popRoot?: HTMLElement;
}

export function buildEditPanels(root: HTMLElement, store: Store<AppState>, a: PanelActions, slots: EditPanelSlots = {}): void {
  const toolRoot = slots.toolRoot ?? root;
  const syncs: Sync[] = [];
  const errors = h("div", { id: "edit-error", class: "notice error", hidden: true });
  const showErr = (m: string | null | undefined) => {
    errors.hidden = !m;
    errors.textContent = m ?? "";
  };

  /** Numeric text input committed on change. `commit` returns an error message or null. */
  const field = (
    id: string,
    label: string,
    get: (s: AppState) => number,
    commit: (v: number) => string | null,
    off?: (s: AppState) => boolean,
    /** Optional text view: `show` renders the value, `empty` is the number an empty field means. */
    view?: { show: (v: number) => string; empty: number },
  ) => {
    const input = control("input", { id, type: "text", inputmode: "decimal", onchange: () => {
      const err = commitNumber(input.value, label, commit, view);
      showErr(err);
      sync(store.get());
    } });
    const sync: Sync = (s) => {
      if (document.activeElement !== input) input.value = view ? view.show(get(s)) : fmt(get(s));
      input.disabled = off ? off(s) : false;
    };
    syncs.push(sync);
    return h("label", { class: "f" }, label, input);
  };
  const check = (id: string, label: string, get: (s: AppState) => boolean, set: (v: boolean) => void, cls?: string) => {
    const input = control("input", { id, type: "checkbox", class: cls, onchange: () => set(input.checked) });
    syncs.push((s) => (input.checked = get(s)));
    return h("label", { class: "f" }, ...(cls ? [label, input] : [input, label]));
  };
  const select = (id: string, label: string, options: [string, string][], get: (s: AppState) => string, set: (v: string) => void) => {
    const el = control("select", { id, onchange: () => set(el.value) }, ...options.map(([v, t]) => h("option", { value: v, text: t })));
    syncs.push((s) => (el.value = get(s)));
    return h("label", { class: "f" }, label, el);
  };
  const button = (id: string, label: string, onclick: () => void) => control("button", { id, onclick }, label);
  /** The `?` help for one header: the anchor sits in the summary, the panel in the popover container, never inside the section. */
  const helpButton = (sec: string, name: string, copy: string) => {
    const anchor = control("button", { id: `${sec}-help`, class: "qm", type: "button", "aria-label": `${name} help` }, "?");
    if (slots.popRoot && slots.pops) {
      const panel = h("div", { class: "pop help-pop", id: `${sec}-help-pop`, role: "dialog", "aria-label": `${name} help`, tabindex: "-1", hidden: true }, h("p", { text: copy }));
      slots.popRoot.append(panel);
      slots.pops.add({ id: `help-${sec}`, anchor, panel });
    }
    return anchor;
  };
  const TOOL_HEAD: Record<string, { name: string; icon: IconName; help: string }> = {
    box: { name: "Box", icon: "box", help: BOX_NOTE },
    polygon: { name: "Polygon", icon: "poly", help: POLYGON_DEPTH_NOTE },
    cluster: { name: "Cluster", icon: "cluster", help: CLUSTER_HELP },
    sparse: { name: "Sparse points", icon: "sparse", help: SPARSE_HELP },
    plane: { name: "Planes", icon: "plane", help: PLANE_HELP },
    thin: { name: "Thin", icon: "thin", help: THIN_HELP },
  };
  /** The shared tool header (the section's summary): icon tile, name, `?`, the Esc hint and a close button that disarms. */
  const toolHead = (id: string): Node[] => {
    const t = TOOL_HEAD[id];
    return [
      h("span", { class: "ticon" }, iconSvg(t.icon)),
      h("h2", { text: t.name }),
      helpButton(id, t.name, t.help),
      h("span", { class: "kbd", text: "Esc to exit" }),
      iconControl(`${id}-exit`, "close", { class: "sm", onclick: () => a.setTool("none") }),
    ];
  };
  const section = (id: SectionId, _title: string, visible: (s: AppState) => boolean, ...kids: (Node | null)[]) => {
    const f = foldable(store, id, toolHead(id), ...kids);
    syncs.push((s) => {
      f.el.hidden = !visible(s);
      f.sync(s);
    });
    return f.el;
  };
  /** A panel section the user can fold; its open state is `floorPanelOpen` (also drives the strong protected colour). */
  const collapsible = (header: Node[], visible: (s: AppState) => boolean, ...kids: (Node | null)[]) => {
    const el = h("details", { class: "panel prot-panel", open: true }, h("summary", { class: "prot-h", title: "Fold or unfold this section; while it is open the protected slab is drawn in a stronger colour" }, ...header), ...kids);
    el.addEventListener("toggle", () => {
      if (el.open !== store.get().floorPanelOpen) store.update((s) => ({ ...s, floorPanelOpen: el.open }));
    });
    const foldSync = foldSyncer(el, (s) => s.floorPanelOpen);
    syncs.push((s) => {
      el.hidden = !visible(s);
      foldSync(s);
    });
    return el;
  };
  const text = (get: (s: AppState) => string, cls = "note") => {
    const el = h("p", { class: cls });
    syncs.push((s) => (el.textContent = get(s)));
    return el;
  };
  const row = (...kids: Node[]) => h("div", { class: "triple" }, ...kids);

  // ---- box
  const boxEdit = (fn: (b: B.BoxModel) => B.BoxEdit): string | null => {
    const r = fn(store.get().tools.box);
    if (!r.ok) return r.error ?? "Invalid box";
    store.update((s) => ({ ...s, tools: { ...s.tools, box: r.box } }));
    a.toolChanged();
    return null;
  };
  const vecField = (kind: "center" | "size", i: 0 | 1 | 2, ax: string) =>
    field(
      `box-${kind}-${ax}`,
      ax.toUpperCase(),
      (s) => (kind === "center" ? s.tools.box.center[i] : s.tools.box.dimensions[i]),
      (v) =>
        boxEdit((b) => {
          const cur = [...(kind === "center" ? b.center : b.dimensions)] as Vec3;
          cur[i] = v;
          return kind === "center" ? B.setCenter(b, cur) : B.setDimensions(b, cur);
        }),
    );
  const rpyField = (i: 0 | 1 | 2, id: string, label: string) =>
    field(id, label, (s) => B.quatToRpy(s.tools.box.quat)[i], (v) =>
      boxEdit((b) => {
        const rpy = B.quatToRpy(b.quat);
        rpy[i] = v;
        return B.setRpy(b, rpy);
      }),
    );
  const mmField = (which: "min" | "max", i: 0 | 1 | 2, ax: string) =>
    field(
      `box-${which}-${ax}`,
      `${which} ${ax.toUpperCase()}`,
      (s) => B.minMaxState(s.tools.box)[which][i],
      (v) =>
        boxEdit((b) => {
          const st = B.minMaxState(b);
          const min = [...st.min] as Vec3;
          const max = [...st.max] as Vec3;
          (which === "min" ? min : max)[i] = v;
          return B.setMinMax(b, min, max);
        }),
      (s) => !B.minMaxState(s.tools.box).enabled,
    );
  const AXN = ["x", "y", "z"] as const;
  const rectButton = iconControl("box-rect", "rect", { onclick: () => store.update((s) => ({ ...s, rect: !s.rect })) });
  syncs.push((s) => {
    const ok = rectAxis(s.camera) !== null;
    rectButton.disabled = !ok;
    rectButton.classList.toggle("active", s.rect && ok);
    rectButton.title = ok ? TOOLTIPS["box-rect"] : `${TOOLTIPS["box-rect"]} (disabled: ${RECT_REASON})`;
  });
  /** A label-left, control-right row (`.prow`); `col` stacks the label above the controls (three-field rows). */
  const prow = (label: string, ctl: Node, col = false) => h("div", { class: col ? "prow col" : "prow" }, h("span", { class: "plabel", text: label }), h("div", { class: "pctl" }, ctl));
  /** A two-option radio group (the Inside/Outside mode); the keys of `options` are the stored values. */
  const segmented = (id: string, label: string, options: [string, string][], get: (s: AppState) => string, set: (v: string) => void) => {
    const btns = options.map(([v, t]) => h("button", { type: "button", role: "radio", "aria-checked": "false", text: t, onclick: () => set(v) }));
    const el = control("div", { id, class: "seg", role: "radiogroup", "aria-label": label }, ...btns);
    syncs.push((s) => options.forEach(([v], k) => btns[k].setAttribute("aria-checked", String(get(s) === v))));
    return el;
  };
  /** A closed `details.disc` disclosure (not persisted). */
  const disc = (title: string, ...kids: Node[]) => h("details", { class: "disc" }, h("summary", {}, iconSvg("chevr"), title), h("div", { class: "inner" }, ...kids));
  const fitItem = (id: string, label: string, run: () => void) => button(id, label, () => {
    run();
    slots.pops?.close();
  });
  const fitMenu = h(
    "div",
    { class: "pop menu", id: "box-fit-menu", role: "menu", "aria-label": "Fit the box", tabindex: "-1", hidden: true },
    fitItem("box-fit-cloud", "Fit cloud", () => {
      const bb = store.get().session?.active_bounds;
      if (bb) boxEdit((b) => ({ ok: true, box: B.fitToBounds(b, bb) }));
    }),
    fitItem("box-fit-displayed", "Fit displayed", () => {
      const s = store.get();
      const bb = s.session?.active_bounds;
      if (bb) boxEdit((b) => ({ ok: true, box: B.fitToBounds(b, displayedBounds(bb, s.tools.filters)) }));
    }),
    fitItem("box-fit-view", "Fit to view", () => {
      const s = store.get();
      const axis = rectAxis(s.camera);
      const depth = axis === null ? null : rectDepth(axis, s.session?.active_bounds ?? null);
      const box = depth ? fitToView(s.tools.box, s.camera, a.viewSize(), depth) : null;
      if (box) boxEdit(() => ({ ok: true, box }));
      else showErr(RECT_REASON);
    }),
    fitItem("box-fit-selection", "Fit selection", () => {
      const bb = store.get().candidate?.bounds;
      if (bb) boxEdit((b) => ({ ok: true, box: B.fitToBounds(b, bb) }));
      else showErr("Preview a selection first; there is no candidate to fit");
    }),
  );
  const fitButton = control("button", { id: "box-fit", type: "button", "aria-haspopup": "menu" }, "Fit ▾");
  slots.pops?.add({ id: "box-fit", anchor: fitButton, panel: fitMenu });
  const resetRotation = iconControl("box-reset-rotation", "level", { onclick: () => boxEdit((b) => ({ ok: true, box: B.resetRotation(b) })) });
  const boxPanel = section(
    "box",
    "Box",
    (s) => s.tool === "box",
    text((s) => B.boxValidity(s.tools.box) ?? ""),
    prow("Select", h("div", { class: "pctl" }, segmented("box-mode", "Box mode", [["inside", "Inside"], ["outside", "Outside"]], (s) => s.tools.box.mode, (v) => {
      boxEdit((b) => ({ ok: true, box: B.setMode(b, v as B.BoxMode) }));
    }), rectButton)),
    prow("Centre", row(...AXN.map((ax, i) => vecField("center", i as 0 | 1 | 2, ax))), true),
    prow("Size", row(...AXN.map((ax, i) => vecField("size", i as 0 | 1 | 2, ax))), true),
    prow("Rotation (deg)", h("div", { class: "rot" }, row(rpyField(0, "box-roll", "Roll"), rpyField(1, "box-pitch", "Pitch"), rpyField(2, "box-yaw", "Yaw")), resetRotation), true),
    disc(
      "Min / max",
      row(...AXN.map((ax, i) => mmField("min", i as 0 | 1 | 2, ax))),
      row(...AXN.map((ax, i) => mmField("max", i as 0 | 1 | 2, ax))),
      text((s) => {
        const m = B.minMaxState(s.tools.box);
        const e = B.worldExtents(s.tools.box);
        return `${m.enabled ? "" : `${m.reason}. `}World extents: ${e.min.map(fmt).join(", ")} to ${e.max.map(fmt).join(", ")}`;
      }),
    ),
    h("div", { class: "btnrow" }, fitButton, button("box-reset", "Reset box", () => boxEdit((b) => ({ ok: true, box: { ...B.resetBox(store.get().camera.target), mode: b.mode } })))),
    fitMenu,
    disc(
      "Handles",
      check("gizmo-snap", "Snap", (s) => s.gizmo.snap, (v) => store.update((s) => ({ ...s, gizmo: { ...s.gizmo, snap: v } })), "switch"),
      row(
        field("gizmo-step", "Step", (s) => s.gizmo.step, (v) => {
          if (!(v > 0)) return "Snap step must be greater than 0";
          store.update((s) => ({ ...s, gizmo: { ...s.gizmo, step: v } }));
          return null;
        }),
        field("gizmo-angle-step", "Angle", (s) => s.gizmo.angleStep, (v) => {
          if (!(v > 0)) return "Angle step must be greater than 0";
          store.update((s) => ({ ...s, gizmo: { ...s.gizmo, angleStep: v } }));
          return null;
        }),
      ),
    ),
  );

  // ---- polygon
  const polyZ = (which: "zMin" | "zMax", id: string, label: string) =>
    field(
      id,
      label,
      (s) => s.tools.polygon[which],
      (v) => {
        const p = store.get().tools.polygon;
        const r = PG.setZ(p, which === "zMin" ? v : p.zMin, which === "zMax" ? v : p.zMax);
        if (!r.ok) return r.message ?? "Invalid Z limit";
        store.update((s) => ({ ...s, tools: { ...s.tools, polygon: r.state } }));
        a.toolChanged();
        return null;
      },
      undefined,
      { show: (v) => PG.zText(v, fmt), empty: which === "zMin" ? -Z_UNLIMITED : Z_UNLIMITED },
    );
  const vertexList = h("div", { class: "verts" });
  let vertKey = "";
  syncs.push((s) => {
    const key = `${s.tools.polygon.phase}|${s.tools.polygon.vertices.length}|${s.tools.polygon.editing}`;
    if (key === vertKey && vertexList.contains(document.activeElement)) return;
    vertKey = key;
    const editing = s.tools.polygon.editing;
    vertexList.replaceChildren(
      ...s.tools.polygon.vertices.map((v, i) => {
        const mk = (axis: 0 | 1) => {
          const inp = h("input", {
            type: "text",
            class: "vert",
            "data-vertex": `${i}-${axis === 0 ? "x" : "y"}`,
            title: `Polygon vertex ${i + 1} ${axis === 0 ? "X" : "Y"} (file frame)`,
            value: fmt(v[axis]),
            onchange: () => {
              const n = Number(inp.value);
              const cur = store.get().tools.polygon.vertices[i];
              const next: [number, number] = axis === 0 ? [n, cur[1]] : [cur[0], n];
              const r = PG.setVertexNumeric(store.get().tools.polygon, i, next);
              if (!r.ok) showErr(r.message ?? "Invalid vertex");
              else {
                showErr(null);
                store.update((st) => ({ ...st, tools: { ...st.tools, polygon: r.state } }));
                a.toolChanged();
              }
            },
          });
          return inp;
        };
        const remove = editing
          ? h("button", {
              type: "button",
              "data-vertex-remove": String(i),
              title: `Remove vertex ${i + 1}`,
              "aria-label": `Remove vertex ${i + 1}`,
              text: "×",
              onclick: () => {
                const r = PG.removeVertex(store.get().tools.polygon, i);
                if (!r.ok) return showErr(r.message ?? "The vertex could not be removed");
                showErr(null);
                store.update((st) => ({ ...st, tools: { ...st.tools, polygon: r.state } }));
                a.toolChanged();
              },
            })
          : null;
        return h("div", { class: editing ? "vertrow editing" : "vertrow" }, h("span", { text: `${i + 1}` }), mk(0), mk(1), remove);
      }),
    );
  });
  const drawBtn = button("poly-draw", "Draw polygon", a.startDrawing);
  const editBtn = iconControl("poly-edit", "pencil", {
    onclick: () => store.update((s) => ({ ...s, tools: { ...s.tools, polygon: PG.setEditing(s.tools.polygon, !s.tools.polygon.editing) } })),
  });
  const polyHint = h("p", { class: "note" });
  syncs.push((s) => {
    const hint = polygonHint(s.tools.polygon);
    polyHint.textContent = hint.text;
    drawBtn.classList.toggle("hint", hint.accentDraw);
    editBtn.disabled = s.tools.polygon.phase !== "closed";
    editBtn.setAttribute("aria-pressed", String(s.tools.polygon.editing));
    editBtn.classList.toggle("active", s.tools.polygon.editing);
  });
  const polyPanel = section(
    "polygon",
    "Polygon",
    (s) => s.tool === "polygon",
    h("div", { class: "stack" }, drawBtn, button("poly-finish", "Close polygon", () => showErr(a.finishPolygon())), button("poly-cancel", "Cancel drawing", a.cancelDrawing), button("poly-clear", "Clear polygon", a.clearPolygon), editBtn),
    polyHint,
    vertexList,
    row(polyZ("zMin", "poly-zmin", "Z min"), polyZ("zMax", "poly-zmax", "Z max")),
    text((s) => PG.polygonProblem(s.tools.polygon) ?? (s.tools.polygon.zMin <= -Z_UNLIMITED && s.tools.polygon.zMax >= Z_UNLIMITED ? "Z limits: unlimited" : "")),
    prow("Select", segmented("poly-mode", "Polygon mode", [["inside", "Inside"], ["outside", "Outside"]], (s) => s.tools.polygon.mode, (v) => {
      store.update((s) => ({ ...s, tools: { ...s.tools, polygon: { ...s.tools.polygon, mode: v as "inside" | "outside" } } }));
      a.toolChanged();
    })),
  );

  // arming a tool opens its section if it was folded (through the store, like a click on its summary) and scrolls the panel to the
  // top, once per arming: the armed tool's section is the first one (the fixed tool slot above File)
  let prevTool = store.get().tool;
  syncs.push((s) => {
    if (s.tool === prevTool) return;
    prevTool = s.tool;
    if (s.tool === "none") return;
    if (!isSectionOpen(s.sectionsOpen, s.tool)) store.update((st) => ({ ...st, sectionsOpen: setSectionOpen(st.sectionsOpen, s.tool as SectionId, true) }));
    if (slots.scroller) slots.scroller.scrollTop = 0;
  });

  // ---- cluster
  // Pick point is a toggle with three states (waiting, set, paused); pressing it always leaves it waiting
  const pickButton = control(
    "button",
    {
      id: "cluster-pick-seed",
      class: "toggle",
      onclick: () => {
        const had = store.get().tools.cluster.seed !== null;
        store.update((s) => ({ ...s, ...pressPick(s) }));
        if (had) a.discardDraft(); // the old seed's draft or preview is gone with it
      },
    },
    "Pick point",
  );
  syncs.push((s) => {
    const st = clusterPickState(s);
    pickButton.setAttribute("data-state", st);
    pickButton.setAttribute("aria-pressed", String(st === "waiting"));
  });
  const clusterPanelEl = section(
    "cluster",
    "Cluster",
    (s) => s.tool === "cluster",
    h("div", { class: "btnrow" }, pickButton, button("cluster-cancel", "Cancel", a.cancelJob)),
    text((s) => pickText(s)),
    field("cluster-radius", "Link distance", (s) => s.tools.cluster.radius, (v) => {
      const r = setRadius(store.get().tools.cluster, v);
      if (!r.ok) return r.error ?? "Invalid radius";
      store.update((s) => ({ ...s, tools: { ...s.tools, cluster: r.model } }));
      a.toolChanged();
      return null;
    }),
    (() => {
      const input = control("input", { id: "cluster-max-points", type: "text", inputmode: "numeric", placeholder: "No limit", onchange: () => {
        const raw = input.value.trim().replace(/[ ,_]/g, "");
        const v = raw === "" ? null : Number(raw);
        if (v !== null && (!Number.isInteger(v) || v < 1)) {
          showErr("Max points must be a whole number of at least 1, or empty for no limit");
        } else {
          showErr(null);
          store.update((s) => ({ ...s, tools: { ...s.tools, cluster: { ...s.tools.cluster, maxPoints: v } } }));
          a.toolChanged();
        }
        sync(store.get());
      } });
      const sync: Sync = (s) => {
        if (document.activeElement !== input) input.value = s.tools.cluster.maxPoints === null ? "" : fmt(s.tools.cluster.maxPoints);
      };
      syncs.push(sync);
      return h("label", { class: "f" }, "Max points", input);
    })(),
    (() => {
      const sel = control("select", { id: "cluster-region", onchange: () => {
        store.update((s) => ({ ...s, tools: { ...s.tools, cluster: { ...s.tools.cluster, region: sel.value as "none" | "box" | "prism" } } }));
        a.toolChanged();
      } });
      syncs.push((s) => {
        const t = currentToolPair(s);
        const opts = regionOptions(t.box, t.prism);
        sel.replaceChildren(...opts.map((o) => h("option", { value: o, text: o === "none" ? "Whole cloud" : o === "box" ? "Current box" : "Current polygon" })));
        sel.value = opts.includes(s.tools.cluster.region) ? s.tools.cluster.region : "none";
      });
      return h("label", { class: "f" }, "Region ", sel);
    })(),
    check("cluster-exclude-protected", "Exclude protected points", (s) => s.tools.cluster.excludeProtected, (v) => {
      store.update((s) => ({ ...s, tools: { ...s.tools, cluster: { ...s.tools.cluster, excludeProtected: v } } }));
      a.toolChanged();
    }, "switch"),
    (() => {
      const dl = h("dl", { id: "cluster-result" });
      syncs.push((s) => dl.replaceChildren(...clusterPanel(s).flatMap((r) => [h("dt", { text: r.label }), h("dd", { text: r.value })])));
      return dl;
    })(),
    text((s) => clusterLimitText(previewClusterOf(s)) ?? (s.notices.some((n) => n.code === "component_limit_reached") ? CLUSTER_LIMIT_TEXT : ""), "note warn"),
  );

  // ---- sparse points: select isolated points (floating artifacts), keep walls and floors
  const sparseEdit = (r: { ok: boolean; model: SparseModel; error?: string }): string | null => {
    if (!r.ok) return r.error ?? "Invalid value";
    store.update((s) => ({ ...s, tools: { ...s.tools, sparse: r.model } }));
    a.toolChanged();
    return null;
  };
  const sparsePanel = section(
    "sparse",
    "Sparse points",
    (s) => s.tool === "sparse",
    text((s) => sparseSummary(s.tools.sparse)),
    (() => {
      const input = control("input", { id: "sparse-radius", type: "text", inputmode: "decimal", placeholder: "From point spacing", onchange: () => {
        const raw = input.value.trim();
        const v = raw === "" ? null : Number(raw);
        showErr(sparseEdit(setSparseRadius(store.get().tools.sparse, v === null || Number.isFinite(v) ? v : Number.NaN)));
        sync(store.get());
      } });
      const sync: Sync = (s) => {
        if (document.activeElement !== input) input.value = s.tools.sparse.radius === null ? "" : fmt(s.tools.sparse.radius);
      };
      syncs.push(sync);
      return h("label", { class: "f" }, "Radius", input);
    })(),
    field("sparse-min", "Min neighbours", (s) => s.tools.sparse.minNeighbours, (v) => sparseEdit(setMinNeighbours(store.get().tools.sparse, v))),
    (() => {
      const sel = control("select", { id: "sparse-region", onchange: () => {
        store.update((s) => ({ ...s, tools: { ...s.tools, sparse: { ...s.tools.sparse, region: sel.value as RegionKind } } }));
        a.toolChanged();
      } });
      syncs.push((s) => {
        const t = currentToolPair(s);
        const opts = regionOptions(t.box, t.prism);
        sel.replaceChildren(...opts.map((o) => h("option", { value: o, text: o === "none" ? "Whole cloud" : o === "box" ? "Current box" : "Current polygon" })));
        sel.value = opts.includes(s.tools.sparse.region) ? s.tools.sparse.region : "none";
      });
      return h("label", { class: "f" }, "Region ", sel);
    })(),
    check("sparse-exclude-protected", "Exclude protected points", (s) => s.tools.sparse.excludeProtected, (v) => {
      store.update((s) => ({ ...s, tools: { ...s.tools, sparse: { ...s.tools.sparse, excludeProtected: v } } }));
      a.toolChanged();
    }, "switch"),
  );

  // ---- planes: detect floor and ceiling planes (read only), choose one, select its points
  const regionSelect = (id: string, key: "plane" | "thin") => {
    const sel = control("select", { id, onchange: () => {
      store.update((s) => ({ ...s, tools: { ...s.tools, [key]: { ...s.tools[key], region: sel.value as RegionKind } } }));
      if (key === "thin" || store.get().planes.chosen) a.toolChanged();
    } });
    syncs.push((s) => {
      const t = currentToolPair(s);
      const opts = regionOptions(t.box, t.prism);
      sel.replaceChildren(...opts.map((o) => h("option", { value: o, text: o === "none" ? "Whole cloud" : o === "box" ? "Current box" : "Current polygon" })));
      sel.value = opts.includes(s.tools[key].region) ? s.tools[key].region : "none";
    });
    return h("label", { class: "f" }, "Region ", sel);
  };
  // distance, tilt and count only steer the next detection; region and protection also change the chosen plane's points
  const planeEdit = (r: { ok: boolean; model: PlaneModel; error?: string }): string | null => {
    if (!r.ok) return r.error ?? "Invalid value";
    store.update((s) => ({ ...s, tools: { ...s.tools, plane: r.model } }));
    return null;
  };
  const detectBtn = button("plane-detect", "Detect planes", () => a.planeDetect());
  const cancelBtn = button("plane-cancel", "Cancel", () => a.planeCancel());
  const planeList = h("div", { id: "plane-list", class: "planelist" });
  let listKey = "";
  syncs.push((s) => {
    detectBtn.disabled = !s.session || s.planes.busy;
    cancelBtn.hidden = !s.planes.busy;
    const fresh = s.session !== null && s.planes.revision === s.session.revision.cloud;
    const key = JSON.stringify([fresh, s.planes.list, s.planes.chosenRow, s.planes.rowNote]);
    if (key === listKey) return;
    listKey = key;
    const rows = fresh && s.planes.list ? planeRows(s.planes.list, s.session?.active_bounds ?? null) : [];
    planeList.replaceChildren(
      ...rows.flatMap((r) => {
        const chosen = s.planes.chosenRow === r.index;
        const sel = h("button", { id: `plane-select-${r.index}`, type: "button", title: "Select the points within the distance of this Detected plane; Delete then removes them", "aria-pressed": String(chosen), onclick: () => a.planeSelect(r.index) }, "Select");
        const band = h("button", { id: `plane-band-${r.index}`, type: "button", title: "Make the height protection band follow this Detected plane (a tilted band when the plane is tilted)", onclick: () => a.planeBand(r.index) }, "Use as protection band");
        const note = s.planes.rowNote?.row === r.index ? [h("p", { class: "note warn", id: `plane-note-${r.index}`, text: s.planes.rowNote.text })] : [];
        return [
          h("div", { class: chosen ? "planerow chosen" : "planerow", "data-plane": String(r.index) }, h("span", { class: "planelabel", text: r.label }), h("span", { class: "planenums", text: `z ${r.z}, tilt ${r.tilt} deg, ${r.count} points` }), sel, band),
          ...note,
        ];
      }),
    );
  });
  const planePanel = section(
    "plane",
    "Planes",
    (s) => s.tool === "plane",
    text((s) => planeSummary(s.tools.plane)),
    field("plane-distance", "Distance", (s) => s.tools.plane.distance, (v) => planeEdit(setPlaneDistance(store.get().tools.plane, v))),
    field("plane-max-tilt", "Max tilt (deg)", (s) => s.tools.plane.maxTilt, (v) => planeEdit(setMaxTilt(store.get().tools.plane, v))),
    field("plane-max", "Max planes", (s) => s.tools.plane.maxPlanes, (v) => planeEdit(setMaxPlanes(store.get().tools.plane, v))),
    regionSelect("plane-region", "plane"),
    check("plane-exclude-protected", "Exclude protected points", (s) => s.tools.plane.excludeProtected, (v) => {
      store.update((s) => ({ ...s, tools: { ...s.tools, plane: { ...s.tools.plane, excludeProtected: v } } }));
      if (store.get().planes.chosen) a.toolChanged();
    }, "switch"),
    h("div", { class: "btnrow" }, detectBtn, cancelBtn),
    text(planesNote, "note"),
    planeList,
  );

  // ---- thin: duplicates and voxel subsample, always a selection that Delete then removes
  const thinEdit = (r: { ok: boolean; model: ThinModel; error?: string }): string | null => {
    if (!r.ok) return r.error ?? "Invalid value";
    store.update((s) => ({ ...s, tools: { ...s.tools, thin: r.model } }));
    a.toolChanged();
    return null;
  };
  const thinDistance = field("thin-distance", "Distance", (s) => s.tools.thin.distance, (v) => thinEdit(setThinDistance(store.get().tools.thin, v)));
  const thinEdge = field("thin-edge", "Voxel edge", (s) => s.tools.thin.edge, (v) => thinEdit(setThinEdge(store.get().tools.thin, v)));
  syncs.push((s) => {
    thinDistance.hidden = s.tools.thin.method !== "duplicates";
    thinEdge.hidden = s.tools.thin.method !== "voxel";
  });
  const thinPanel = section(
    "thin",
    "Thin",
    (s) => s.tool === "thin",
    text((s) => thinSummary(s.tools.thin)),
    select("thin-method", "Method", [["duplicates", "Duplicates"], ["voxel", "Voxel grid"]], (s) => s.tools.thin.method, (v) => showErr(thinEdit(setThinMethod(store.get().tools.thin, v as "duplicates" | "voxel")))),
    thinDistance,
    thinEdge,
    regionSelect("thin-region", "thin"),
    check("thin-exclude-protected", "Exclude protected points", (s) => s.tools.thin.excludeProtected, (v) => {
      store.update((s) => ({ ...s, tools: { ...s.tools, thin: { ...s.tools.thin, excludeProtected: v } } }));
      a.toolChanged();
    }, "switch"),
  );

  // ---- filters (the six boxes live on the canvas, see filterboxes/; the panel keeps the note, summary and global reset)
  const filterPanel = h(
    "section",
    { class: "panel", id: "display-filter" },
    h("h2", { text: "Display filter" }),
    h("p", { class: "note", text: FILTER_COPY }),
    text((s) =>
      s.session ? `${filterSummary(s.tools.filters, s.session.bounds, s.session.counts)}. Displayed: ${s.session.counts.displayed.toLocaleString("en-US")} of ${s.session.counts.active.toLocaleString("en-US")} active points` : "",
    ),
    h("div", { class: "stack" }, button("filter-reset-all", "Reset filters", a.filterResetAll)),
  );

  syncs.push((s) => (filterPanel.hidden = s.session === null));

  // ---- protection
  const prot = (fn: (m: P.ProtectionModel) => P.ProtectionEdit) => showErr(a.protectionEdit(fn).error);
  // a refused tilt says why right under the fields (the shared #edit-error sits at the top of the panels, out of sight from here)
  const tiltNote = h("p", { id: "prot-tilt-note", class: "note warn", hidden: true });
  const tiltKey = (s: AppState) => `${s.tools.protection.tilt.rx},${s.tools.protection.tilt.ry}`;
  let noteAt = "";
  const tiltMsg = (m: string | null) => {
    tiltNote.hidden = !m;
    tiltNote.textContent = m ?? "";
    noteAt = tiltKey(store.get());
  };
  syncs.push((s) => {
    if (!tiltNote.hidden && tiltKey(s) !== noteAt) tiltMsg(null); // the tilt moved by a ring drag or Level: the refusal is outdated
  });
  const tilt = (patch: { rx?: number; ry?: number }) => {
    const b = store.get().session?.active_bounds;
    const centre: [number, number] = b ? [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2] : [0, 0];
    const r = a.protectionEdit((m) => P.setTilt(m, patch, centre));
    tiltMsg(r.ok ? null : (r.error ?? "Invalid"));
    return r.ok ? null : (r.error ?? "Invalid");
  };
  const protSwitch = control("input", { id: "prot-enabled", type: "checkbox", role: "switch", class: "switch", "aria-label": "Global protection", onchange: () => prot((m) => P.setGlobal(m, { enabled: protSwitch.checked })) });
  syncs.push((s) => (protSwitch.checked = s.tools.protection.global.enabled));
  const protPanel = collapsible(
    [iconSvg("chevr"), iconSvg("shield"), h("h2", { text: "Height protection" }), helpButton("prot", "Height protection", PROTECTION_COPY), protSwitch],
    (s) => s.session !== null,
    prow("Height", row(
      field("prot-min", "Min Z", (s) => s.tools.protection.global.min, (v) => { const r = a.protectionEdit((m) => P.setGlobal(m, { min: v })); return r.ok ? null : (r.error ?? "Invalid"); }),
      field("prot-max", "Max Z", (s) => s.tools.protection.global.max, (v) => { const r = a.protectionEdit((m) => P.setGlobal(m, { max: v })); return r.ok ? null : (r.error ?? "Invalid"); }),
    ), true),
    prow("Floor", h("div", { class: "rot" },
      control("button", { id: "prot-pick-floor", type: "button", onclick: () => store.set({ interaction: store.get().interaction === "pick-floor" ? "orbit" : "pick-floor" }) }, iconSvg("pick"), " Pick point"),
      field("prot-floor-t", "Floor +/-", (s) => s.floorT, (v) => {
        if (!P.intervalFromPick(0, v).ok) return "The floor thickness must be a number above 0";
        store.update((s) => ({ ...s, floorT: v }));
        return null;
      }),
    ), true),
    prow("Tilt", h("div", { class: "rot" }, row(
      field("prot-tilt-x", "Tilt X (deg)", (s) => s.tools.protection.tilt.rx, (v) => tilt({ rx: v })),
      field("prot-tilt-y", "Tilt Y (deg)", (s) => s.tools.protection.tilt.ry, (v) => tilt({ ry: v })),
    ), iconControl("prot-level", "level", { onclick: () => { tiltMsg(null); prot((m) => ({ ok: true, model: P.levelled(m) })); } })), true),
    tiltNote,
    prow("Show band", (() => {
      // "Show band": hides the whole band on the canvas (fill, outline, arrows, rings); protection stays on, so it is not a protection edit
      const sw = control("button", { id: "prot-show-band", role: "switch", class: "toggle switch", onclick: () => store.update((s) => ({ ...s, bandVisible: !s.bandVisible })) }, iconSvg("eye", 16), " Show band");
      let drawn: boolean | null = null; // the icon is rebuilt only when bandVisible changes, not on every store update
      syncs.push((s) => {
        if (drawn === s.bandVisible) return;
        drawn = s.bandVisible;
        sw.setAttribute("aria-checked", String(s.bandVisible));
        sw.replaceChildren(iconSvg(s.bandVisible ? "eye" : "eyeoff", 16), " Show band");
      });
      return sw;
    })()),
    prow("This edit", select("prot-mode", "", [["inherit", "Use global"], ["add_local", "Add local slab"], ["override", "Override global"]], (s) => s.tools.protection.mode, (v) => prot((m) => ({ ok: true, model: P.setOperationMode(m, v as P.OpMode) })))),
    row(
      field("prot-local-min", "Local min", (s) => s.tools.protection.local?.min ?? 0, (v) => { const r = a.protectionEdit((m) => P.setLocal(m, { min: v, max: m.local?.max ?? v })); return r.ok ? null : (r.error ?? "Invalid"); }, (s) => s.tools.protection.mode === "inherit"),
      field("prot-local-max", "Local max", (s) => s.tools.protection.local?.max ?? 0, (v) => { const r = a.protectionEdit((m) => P.setLocal(m, { min: m.local?.min ?? v, max: v })); return r.ok ? null : (r.error ?? "Invalid"); }, (s) => s.tools.protection.mode === "inherit"),
    ),
    (() => {
      const wrap = check("prot-ack", "I understand: override ignores global protection", (s) => s.tools.protection.ack, (v) => prot((m) => ({ ok: true, model: P.acknowledge(m, v) })));
      syncs.push((s) => (wrap.hidden = s.tools.protection.mode !== "override"));
      return wrap;
    })(),
    text((s) => P.protectionBlock(s.tools.protection) ?? ""),
    text((s) => retainedText(s.candidate), "note retained"),
    text((s) => effectiveText(s.candidate)),
  );

  const idle = h("p", { class: "idle-tool", text: "Pick a tool on the canvas to start a selection." });
  syncs.push((s) => (idle.hidden = !(s.session !== null && s.tool === "none")));
  root.append(errors);
  toolRoot.append(idle, boxPanel, polyPanel, clusterPanelEl, sparsePanel, planePanel, thinPanel);
  root.append(filterPanel, protPanel);
  const syncAll = (s: AppState) => {
    for (const f of syncs) f(s);
  };
  store.subscribe(syncAll);
  syncAll(store.get());
}

function currentToolPair(s: AppState) {
  const box = B.toBoxTool(s.tools.box);
  const prism = PG.toPrismTool(s.tools.polygon);
  return { box, prism };
}
