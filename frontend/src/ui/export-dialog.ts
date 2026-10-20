import type { ExportFormat, ExportScope } from "../files/downloads";
import { exportDefaults, exportInfo } from "../orchestration/export";
import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import { control } from "./controls";
import { hiddenExportNote } from "../view/hidden";
import { h } from "./dom";

/** Modal export dialog: scope and format with an exact summary of what is exported. */
export function buildExportDialog(store: Store<AppState>, run: (o: { scope: ExportScope; format: ExportFormat }) => Promise<unknown>) {
  const def = exportDefaults();
  const scope = control(
    "select",
    { id: "export-scope", onchange: update },
    ...(
      [
        ["active", "All active points (default)"],
        ["displayed", "Displayed points only"],
        ["selected", "Selected points only"],
      ] as const
    ).map(([v, t]) => h("option", { value: v, text: t, selected: v === def.scope })),
  );
  const format = control(
    "select",
    { id: "export-format" },
    ...(
      [
        ["binary", "Binary (default)"],
        ["ascii", "ASCII"],
      ] as const
    ).map(([v, t]) => h("option", { value: v, text: t, selected: v === def.format })),
  );
  const summary = h("p", { id: "export-summary" });
  const invalid = h("p", { id: "export-invalid", class: "note" });
  const structure = h("p", { id: "export-structure", class: "note" });
  const hiddenNote = h("p", { id: "export-hidden", class: "note" });
  const dialog = h("dialog", { id: "export-dialog" });
  const go = control(
    "button",
    {
      id: "export-go",
      onclick: async () => {
        go.disabled = true;
        try {
          await run({ scope: scope.value as ExportScope, format: format.value as ExportFormat });
        } finally {
          go.disabled = false;
          dialog.close();
        }
      },
    },
    "Export",
  );
  const cancel = control("button", { id: "export-cancel", onclick: () => dialog.close() }, "Cancel");
  dialog.append(
    h("h3", { text: "Export cleaned cloud" }),
    h("label", { class: "f" }, "Scope ", scope),
    h("label", { class: "f" }, "Format ", format),
    summary,
    invalid,
    structure,
    hiddenNote,
    h("p", { class: "note", text: "The file is a new download named <original>_cleaned.pcd; your browser decides where it is saved and the source file is never overwritten." }),
    h("div", { class: "stack" }, go, cancel),
  );
  document.body.append(dialog);

  function update() {
    const c = store.get().session?.counts;
    if (!c) return;
    const info = exportInfo(c, scope.value as ExportScope);
    summary.textContent = info.summary;
    invalid.textContent = info.retainedInvalid ?? "";
    structure.textContent = info.structureNote;
    hiddenNote.textContent = hiddenExportNote(store.get().hidden.size);
    go.disabled = (scope.value === "selected" && c.selected === 0) || (scope.value === "displayed" && c.displayed === 0);
    go.title = go.disabled ? "Nothing to export for this scope" : "Prepare the export and start the browser download";
  }
  return {
    open() {
      scope.value = def.scope;
      format.value = def.format;
      update();
      dialog.showModal();
    },
  };
}
