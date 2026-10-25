import type { ExportFormat, ExportScope, PerLayerExport } from "../files/downloads";
import { exportDefaults, exportInfo } from "../orchestration/export";
import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import { control } from "./controls";
import { EXPORT_WITHIN_LAYERS, NONE_TICKED, exportItems, exportedCount, hiddenExportNote, hiddenPointCount, layersForRequest } from "../layers/model";
import { h } from "./dom";

/** Modal export dialog: scope and format with an exact summary of what is exported. */
export function buildExportDialog(store: Store<AppState>, run: (o: { scope: ExportScope; format: ExportFormat; layers?: number[]; perLayer?: boolean }) => Promise<unknown>) {
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
  // layer picker: Main first, one tick per layer; only shown when the session has layers
  const ticked = new Set<number>();
  const pickerRows = h("div", { class: "export-layer-rows" });
  const exportAll = control("button", { id: "export-all", type: "button", onclick: () => (tickAll(), update()) }, "Export all layers");
  const picker = h("div", { id: "export-layers", class: "export-layers", hidden: true }, h("p", { class: "note", text: "Layers to export (hidden layers are exported when ticked)" }), pickerRows, exportAll);
  const perLayer = control("input", { id: "export-per-layer", type: "checkbox", onchange: () => update() });
  const perLayerRow = h("label", { class: "f", hidden: true }, perLayer, " One file per layer");
  const filesBox = h("div", { id: "export-files", class: "note", hidden: true });
  const close = control("button", { id: "export-close", type: "button", hidden: true, onclick: () => dialog.close() }, "Close");
  const showFiles = (r: Partial<PerLayerExport> | undefined) => {
    if (!r?.files) return false;
    filesBox.replaceChildren(
      ...r.files.map((f) => h("a", { href: f.url, download: f.filename, "data-export-file": f.filename, text: `${f.filename} (${f.count.toLocaleString("en-US")})` })),
      ...(r.skipped?.length ? [h("p", { text: `Skipped, nothing in scope: ${r.skipped.map((s) => s.layer_name).join(", ")}` })] : []),
    );
    filesBox.hidden = false;
    close.hidden = false;
    return true;
  };
  let pickerKey = "";
  const tickAll = () => {
    ticked.clear();
    for (const i of exportItems(store.get().session)) ticked.add(i.id);
    pickerKey = "";
  };
  function drawPicker() {
    const items = exportItems(store.get().session);
    picker.hidden = items.length === 0;
    const key = JSON.stringify(items);
    if (key === pickerKey) return;
    pickerKey = key;
    pickerRows.replaceChildren(
      ...items.map((i) => {
        const box = h("input", { type: "checkbox", "data-export-layer": i.id, onchange: () => (box.checked ? ticked.add(i.id) : ticked.delete(i.id), update()) });
        box.checked = ticked.has(i.id);
        return h("label", { class: "f" }, box, i.label);
      }),
    );
  }
  const go = control(
    "button",
    {
      id: "export-go",
      class: "primary",
      onclick: async () => {
        go.disabled = true;
        let keepOpen = false;
        try {
          const layers = layersForRequest(store.get().session, ticked);
          const per = perLayer.checked && !perLayerRow.hidden;
          const r = await run({ scope: scope.value as ExportScope, format: format.value as ExportFormat, ...(per ? { perLayer: true } : {}), ...(layers ? { layers } : {}) });
          keepOpen = per && showFiles(r as Partial<PerLayerExport> | undefined);
        } finally {
          go.disabled = false;
          if (!keepOpen) dialog.close();
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
    picker,
    perLayerRow,
    summary,
    invalid,
    structure,
    hiddenNote,
    h("p", { class: "note", text: "The file is a new download named <original>_cleaned.pcd; your browser decides where it is saved and the source file is never overwritten." }),
    filesBox,
    h("div", { class: "foot" }, cancel, close, go),
  );
  document.body.append(dialog);

  function update() {
    const c = store.get().session?.counts;
    if (!c) return;
    drawPicker();
    const sess = store.get().session;
    perLayerRow.hidden = perLayer.hidden = exportItems(sess).length === 0;
    const per = perLayer.checked && !perLayerRow.hidden;
    const info = exportInfo(c, scope.value as ExportScope);
    const subset = sess ? layersForRequest(sess, ticked) : null;
    const chosen = sess ? exportItems(sess).filter((i) => ticked.has(i.id)) : [];
    const perText = `Exports ${chosen.length} file${chosen.length === 1 ? "" : "s"}, one per chosen layer`;
    summary.textContent = per && sess ? (scope.value === "active" ? `${perText}: ${chosen.map((i) => `${i.id === 0 ? "Main" : (sess.layers.find((l) => l.id === i.id)?.name ?? i.id)} ${i.count.toLocaleString("en-US")}`).join(", ")}` : `${perText} (${EXPORT_WITHIN_LAYERS})`) : !sess || !subset ? info.summary : scope.value === "active" ? `Exports ${exportedCount(sess, ticked).toLocaleString("en-US")} points from the chosen layers` : `${info.summary} (${EXPORT_WITHIN_LAYERS})`;
    invalid.textContent = info.retainedInvalid ?? "";
    structure.textContent = info.structureNote;
    hiddenNote.textContent = hiddenExportNote(hiddenPointCount(store.get().session));
    go.disabled = (scope.value === "selected" && c.selected === 0) || (scope.value === "displayed" && c.displayed === 0);
    const none = subset !== null && subset.length === 0;
    go.disabled = go.disabled || none;
    go.title = none ? NONE_TICKED : go.disabled ? "Nothing to export for this scope" : "Prepare the export and start the browser download";
  }
  return {
    open() {
      scope.value = def.scope;
      format.value = def.format;
      tickAll();
      perLayer.checked = false;
      filesBox.replaceChildren();
      filesBox.hidden = true;
      close.hidden = true;
      update();
      dialog.showModal();
    },
  };
}
