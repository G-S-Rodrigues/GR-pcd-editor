import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import { control } from "./controls";
import { h } from "./dom";

export interface ToolbarActions {
  pickFile: (file: File) => void;
  openMounted: () => void;
}

/** File and edit buttons. Save, Export, Undo, Redo, Preview and Apply stay disabled, with a reason, until they are wired. */
export function buildToolbar(root: HTMLElement, _store: Store<AppState>, a: ToolbarActions): void {
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
  root.append(
    input,
    control("button", { id: "open-file", onclick: () => input.click() }, "Open from this computer"),
    control("button", { id: "open-mounted", onclick: a.openMounted }, "Open from mounted folder"),
    h("span", { class: "sep" }),
    control("button", { id: "save-session", ...pending }, "Save session"),
    control("button", { id: "export", ...pending }, "Export"),
    h("span", { class: "sep" }),
    control("button", { id: "undo", ...pending }, "Undo"),
    control("button", { id: "redo", ...pending }, "Redo"),
    control("button", { id: "preview", ...pending }, "Preview"),
    control("button", { id: "apply", ...pending }, "Apply"),
  );
}
