import { protectionBlock } from "../inspector/protection";
import { canApply } from "../orchestration/runner";
import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import { control } from "./controls";
import { h } from "./dom";

export interface ToolbarActions {
  pickFile: (file: File) => void;
  openMounted: () => void;
  preview: () => void;
  apply: () => void;
  undo: () => void;
  redo: () => void;
}

/** File and edit buttons. Save and Export stay disabled, with a reason, until they are wired (next step). */
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
  const pending = { disabled: true, reason: "available in the next step" };
  const undo = control("button", { id: "undo", disabled: true, onclick: a.undo }, "Undo");
  const redo = control("button", { id: "redo", disabled: true, onclick: a.redo }, "Redo");
  const preview = control("button", { id: "preview", disabled: true, onclick: a.preview }, "Preview");
  const apply = control("button", { id: "apply", disabled: true, onclick: a.apply }, "Apply");
  root.append(
    input,
    control("button", { id: "open-file", onclick: () => input.click() }, "Open from this computer"),
    control("button", { id: "open-mounted", onclick: a.openMounted }, "Open from mounted folder"),
    h("span", { class: "sep" }),
    control("button", { id: "save-session", ...pending }, "Save session"),
    control("button", { id: "export", ...pending }, "Export"),
    h("span", { class: "sep" }),
    undo,
    redo,
    preview,
    apply,
  );
  const tips = new Map([undo, redo, preview, apply].map((b) => [b, b.title]));
  const set = (b: HTMLButtonElement, on: boolean, why: string) => {
    b.disabled = !on;
    b.title = on ? (tips.get(b) ?? "") : `${tips.get(b)} (${why})`;
  };
  const sync = (s: AppState) => {
    const idle = !s.job.busy;
    set(undo, !!s.session?.history.can_undo && idle, s.session ? "nothing to undo" : "no file open");
    set(redo, !!s.session?.history.can_redo && idle, s.session ? "nothing to redo" : "no file open");
    set(preview, !!s.session && idle, s.session ? "a job is running" : "no file open");
    set(
      apply,
      canApply(s),
      !s.session
        ? "no file open"
        : s.job.busy
          ? "a job is running"
          : s.draft
            ? "commit or discard the drafted tool shape first"
            : protectionBlock(s.tools.protection) ?? (s.candidate ? "the preview is out of date or empty; preview again" : "preview a selection first"),
    );
  };
  store.subscribe(sync);
  sync(store.get());
}
