import * as P from "../inspector/protection";
import { type AppState, addNotice } from "../state/app";
import { deleteBlockedNote } from "../orchestration/runner";
import type { Store } from "../state/store";
import { clusterLimitText } from "../tools/cluster/model";
import { headline } from "../status/headline";
import { commitEnabled, commitLabel, discardEnabled, previewClusterOf, previewParts } from "../tools/preview";
import { scopeNotice, selectionDisabledReason } from "../orchestration/selection";
import { hideState } from "../orchestration/hide";
import { control } from "./controls";
import { SELECTED_COLOURS, type SelectedColourId, selectedPresets } from "../colour/selectcolour";
import { cssColour } from "./legend";
import { iconControl } from "./iconbutton";
import { iconSvg } from "./icons";
import { TOOLTIPS } from "./tooltips";
import { h } from "./dom";
import { foldable } from "./fold";
import type { PanelActions } from "./panels";

type Sync = (s: AppState) => void;

/** A label-left, control-right row (`.prow`). */
const prow = (label: string, ctl: Node) => h("div", { class: "prow" }, h("span", { class: "plabel", text: label }), h("div", { class: "pctl" }, ctl));

/** The first-selection note: the short line is visible, the advice is its tooltip (part 17-10). */
export const LIVE_NOTE = "First selection: edits are live.";
export const LIVE_NOTE_TITLE = "First selection: edits are live. Choose Add, Subtract or Intersect to preview changes instead.";

/** The Selection section of the left sidebar (22-7): a foldable section holding the operation, scope, colour, actions and notes. */
export function buildSelectionPanel(root: HTMLElement, store: Store<AppState>, a: PanelActions): void {
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
  const op = control("div", { id: "op-select", role: "radiogroup", "aria-label": "Operation", class: "seg icons" }, ...opBtns);
  const previewLive = control("button", {
    id: "preview-live",
    type: "button",
    role: "switch",
    class: "switch",
    onclick: () => {
      store.set({ previewLive: !store.get().previewLive });
      const s = store.get();
      if (s.draft && s.tool !== "none") a.toolChanged(); // turning it on previews the shape now; off drops the old preview
    },
  });
  const liveNote = h("p", { id: "live-note", class: "note", hidden: true });
  // Scope: a two-segment radiogroup (roving tabindex, arrows move the choice); a click on the checked one does nothing
  const SCOPES = [
    ["displayed", "scope-displayed", "Displayed"],
    ["active", "scope-active", "Active"],
  ] as const;
  const chooseScope = (value: AppState["scope"]) => {
    if (store.get().scope === value) return;
    store.set({ scope: value });
    a.scopeChanged();
  };
  const scopeBtns = SCOPES.map(([value, id, text], i) =>
    control(
      "button",
      {
        id,
        type: "button",
        role: "radio",
        onclick: () => chooseScope(value),
        onkeydown: (e: KeyboardEvent) => {
          const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
          if (!d) return;
          e.preventDefault();
          const j = (i + d + SCOPES.length) % SCOPES.length;
          chooseScope(SCOPES[j][0]);
          scopeBtns[j].focus();
        },
      },
      text,
    ),
  );
  const scope = control("div", { id: "scope-select", role: "radiogroup", "aria-label": "Scope", class: "seg" }, ...scopeBtns);
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
  const swatchGroup = control("div", { id: "sel-colour", role: "radiogroup", "aria-label": "Selected colour", class: "dots" }, ...swatches);
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
  const fold = foldable(
    store,
    "selection",
    h("h2", { text: "Selection" }),
    prow("Operation", op),
    prow("Live preview", previewLive),
    liveNote,
    prow("Scope", scope),
    prow("Highlight", swatchGroup),
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
  );
  root.append(fold.el);
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
    liveNote.hidden = !(s.liveFirst && s.tool !== "none");
    liveNote.textContent = liveNote.hidden ? "" : LIVE_NOTE;
    liveNote.title = liveNote.hidden ? "" : LIVE_NOTE_TITLE;
    SCOPES.forEach(([value], i) => {
      const on = s.scope === value;
      scopeBtns[i].setAttribute("aria-checked", String(on));
      scopeBtns[i].tabIndex = on ? 0 : -1;
    });
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
  store.subscribe((s) => {
    fold.sync(s);
    sync(s);
  });
  sync(store.get());
}
