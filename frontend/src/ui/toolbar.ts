import { applyBlockedText, canApply } from "../orchestration/runner";
import { headline } from "../status/headline";
import { shouldWarn, unsavedLabel } from "../orchestration/unsaved";
import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import { control } from "./controls";
import { h } from "./dom";
import { iconControl } from "./iconbutton";

export interface ToolbarActions {
  pickFile: (file: File) => void;
  preview: () => void;
  apply: () => void;
  undo: () => void;
  redo: () => void;
  saveSession: () => void;
  openExport: () => void;
}

/** File and edit buttons. Edit buttons are disabled with a reason outside the edited view. */
export function buildToolbar(root: HTMLElement, store: Store<AppState>, a: ToolbarActions): void {
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
  const badge = h("span", { id: "unsaved-badge", class: "badge" });
  const undo = iconControl("undo", "undo", { disabled: true, onclick: a.undo });
  const redo = iconControl("redo", "redo", { disabled: true, onclick: a.redo });
  const preview = control("button", { id: "preview", disabled: true, onclick: a.preview }, "Preview");
  const apply = control("button", { id: "apply", disabled: true, onclick: a.apply }, "Apply");
  const hlDelete = h("span", { id: "headline-delete", class: "headline" });
  const hlKept = h("span", { id: "headline-kept", class: "headline" });
  root.append(
    input,
    iconControl("open-file", "open", { onclick: () => input.click() }),
    h("span", { class: "sep" }),
    save,
    exp,
    badge,
    h("span", { class: "sep" }),
    undo,
    redo,
    preview,
    apply,
    hlDelete,
    hlKept,
  );
  const tips = new Map([undo, redo, preview, apply, save, exp].map((b) => [b, b.title]));
  const set = (b: HTMLButtonElement, on: boolean, why: string) => {
    b.disabled = !on;
    b.title = on ? (tips.get(b) ?? "") : `${tips.get(b)} (${why})`;
  };
  const sync = (s: AppState) => {
    const idle = !s.job.busy && s.compare === "edited";
    const why = s.compare !== "edited" ? "return to the edited view" : "a job is running";
    const hl = headline(s);
    hlDelete.textContent = hl.willDelete;
    hlKept.textContent = hl.kept;
    hlKept.classList.toggle("warn", hl.keptCount > 0);
    badge.textContent = unsavedLabel(s);
    badge.classList.toggle("on", shouldWarn(s));
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
  };
  store.subscribe(sync);
  sync(store.get());
}
