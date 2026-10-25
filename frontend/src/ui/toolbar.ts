import { applyBlockedText, canApply } from "../orchestration/runner";
import { headline } from "../status/headline";
import { shouldWarn, unsavedLabel } from "../orchestration/unsaved";
import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import { control } from "./controls";
import { h } from "./dom";
import { iconControl } from "./iconbutton";
import { iconSvg } from "./icons";

export interface ToolbarActions {
  pickFile: (file: File) => void;
  preview: () => void;
  apply: () => void;
  undo: () => void;
  redo: () => void;
  saveSession: () => void;
  openExport: () => void;
}

export interface ToolbarParts {
  /** The centre group: main.ts builds the data mode into it. */
  centre: HTMLElement;
  /** The popover anchors of the right group. */
  anchors: { display: HTMLButtonElement; details: HTMLButtonElement; help: HTMLButtonElement };
}

/** File and edit buttons. Edit buttons are disabled with a reason outside the edited view. */
export function buildToolbar(root: HTMLElement, store: Store<AppState>, a: ToolbarActions): ToolbarParts {
  const input = h("input", {
    type: "file",
    accept: ".pcd,.pcdsession",
    id: "file-input",
    hidden: true,
    onchange: () => {
      const f = input.files?.[0];
      if (f) a.pickFile(f);
      input.value = "";
    },
  });
  const save = iconControl("save-session", "save", { disabled: true, onclick: a.saveSession });
  const exp = iconControl("export", "exp", { disabled: true, onclick: a.openExport });
  const title = h("b", { id: "doc-title" });
  const dot = h("span", { class: "dot" });
  const badge = h("span", { id: "unsaved-badge", class: "doc-sub" }, dot, "Edited");
  const undo = iconControl("undo", "undo", { disabled: true, onclick: a.undo });
  const redo = iconControl("redo", "redo", { disabled: true, onclick: a.redo });
  const preview = control("button", { id: "preview", disabled: true, onclick: a.preview }, "Preview");
  const trash = iconSvg("trash", 16);
  const apply = control("button", { id: "apply", class: "danger", disabled: true, onclick: a.apply }, trash, " Delete");
  const shield = iconSvg("shield", 14);
  const kept = h("span", { id: "kept-chip", hidden: true }, shield, "");
  const display = iconControl("display-open", "sliders");
  const details = iconControl("details-open", "info");
  const help = iconControl("help", "keyboard");
  const centre = h("div", { class: "grp centre" });
  root.append(
    h(
      "div",
      { class: "grp left" },
      input,
      h("div", { class: "doc" }, h("div", { class: "appmark" }, iconSvg("box", 14)), h("div", { class: "t" }, title, badge)),
      iconControl("open-file", "open", { onclick: () => input.click() }),
      save,
      exp,
      h("span", { class: "tsep" }),
      undo,
      redo,
    ),
    centre,
    h("div", { class: "grp right" }, display, details, help, h("span", { class: "tsep" }), preview, kept, apply),
  );
  const tips = new Map([undo, redo, preview, apply, save, exp].map((b) => [b, b.title]));
  const set = (b: HTMLButtonElement, on: boolean, why: string) => {
    b.disabled = !on;
    b.title = on ? (tips.get(b) ?? "") : `${tips.get(b)} (${why})`;
  };
  let applyLabel = "Delete";
  let keptLabel: string | null = null;
  const sync = (s: AppState) => {
    const idle = !s.job.busy && s.compare === "edited";
    const why = s.compare !== "edited" ? "return to the edited view" : "a job is running";
    const hl = headline(s);
    if (applyLabel !== hl.deleteLabel) {
      applyLabel = hl.deleteLabel;
      apply.replaceChildren(trash, ` ${applyLabel}`);
    }
    if (keptLabel !== hl.keptLabel) {
      keptLabel = hl.keptLabel;
      kept.replaceChildren(shield, keptLabel ?? "");
    }
    kept.hidden = hl.keptLabel === null;
    kept.title = hl.kept;
    const name = s.session?.filename ?? null;
    title.textContent = name ?? "No file open";
    title.title = name ?? "";
    badge.hidden = !shouldWarn(s);
    badge.title = unsavedLabel(s);
    set(save, !!s.session && !s.job.busy, s.session ? "a job is running" : "no file open");
    set(exp, !!s.session && !s.job.busy, s.session ? "a job is running" : "no file open");
    set(undo, !!s.session?.history.can_undo && idle, s.session ? (idle ? "nothing to undo" : why) : "no file open");
    set(redo, !!s.session?.history.can_redo && idle, s.session ? (idle ? "nothing to redo" : why) : "no file open");
    set(preview, !!s.session && idle, s.session ? why : "no file open");
    set(
      apply,
      canApply(s) && s.compare === "edited",
      applyBlockedText(s),
    );
    if (s.draft && canApply(s) && s.compare === "edited") {
      apply.title = `${tips.get(apply) ?? ""} (a draft is pending: Apply deletes only the ${(s.session?.selection.count ?? 0).toLocaleString("en-US")} committed selected points, not the preview)`;
    }
  };
  store.subscribe(sync);
  sync(store.get());
  return { centre, anchors: { display, details, help } };
}
