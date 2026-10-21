import type { Download, ExportFormat, ExportScope, PerLayerExport } from "../files/downloads";
import { type AppState, addNotice } from "../state/app";
import type { Store } from "../state/store";
import type { Counts } from "../state/types";

export interface ExportOptions {
  scope: ExportScope;
  format: ExportFormat;
  /** A strict subset of layer ids (0 = main); absent means every layer. */
  layers?: number[];
  /** One file per chosen layer. */
  perLayer?: boolean;
}
export interface ExportDeps {
  startExport(format: ExportFormat, scope: ExportScope, layers?: number[]): Promise<Download>;
  startExportPerLayer?(format: ExportFormat, scope: ExportScope, layers?: number[]): Promise<PerLayerExport>;
}

const n = (v: number) => v.toLocaleString("en-US");

/** Display filters never change the default: it exports every active point. */
export const exportDefaults = (): ExportOptions => ({ scope: "active", format: "binary" });

export function exportInfo(c: Counts, scope: ExportScope) {
  const summary =
    scope === "active"
      ? `Exports all ${n(c.active)} active points; ${n(c.original - c.active)} deleted points are excluded`
      : scope === "displayed"
        ? `Exports ${n(c.displayed)} displayed points; ${n(c.active - c.displayed)} active points are excluded`
        : `Exports ${n(c.selected)} selected points; ${n(c.active - c.selected)} active points are excluded`;
  return {
    summary,
    retainedInvalid:
      c.invalid_active > 0 ? `${n(c.invalid_active)} invalid (NaN/Infinity) points are retained in the export` : null,
    structureNote:
      "The organised (grid) structure of the cloud is lost once points are deleted; the export is an unorganised cloud.",
  };
}

export async function runExport(
  store: Store<AppState>,
  opts: ExportOptions,
  deps: ExportDeps,
): Promise<{ ok: boolean; message: string } & Partial<PerLayerExport>> {
  try {
    if (opts.perLayer && deps.startExportPerLayer) {
      const r = await (opts.layers ? deps.startExportPerLayer(opts.format, opts.scope, opts.layers) : deps.startExportPerLayer(opts.format, opts.scope));
      const list = r.files.map((f) => `${f.filename} (${n(f.count)} point${f.count === 1 ? "" : "s"})`).join(", ");
      const skipped = r.skipped.length ? ` Skipped, nothing in scope: ${r.skipped.map((s) => s.layer_name).join(", ")}.` : "";
      const message = `Export prepared as ${r.files.length} file${r.files.length === 1 ? "" : "s"}; your browser decides where ${r.files.length === 1 ? "it is" : "they are"} saved: ${list}.${skipped} The source file is never overwritten.`;
      addNotice(store, "info", "export_done", message);
      return { ok: true, message, files: r.files, skipped: r.skipped };
    }
    const dl = opts.layers ? await deps.startExport(opts.format, opts.scope, opts.layers) : await deps.startExport(opts.format, opts.scope);
    const exact = opts.layers && dl.count !== undefined ? ` ${n(dl.count)} points exported.` : "";
    const message = `Export prepared; your browser decides where it is saved. Suggested name: ${dl.filename}. The source file is never overwritten.${exact}`;
    addNotice(store, "info", "export_done", message);
    return { ok: true, message };
  } catch (e) {
    const message = `Export failed: ${e instanceof Error ? e.message : "unknown error"}`;
    addNotice(store, "error", "export_failed", message);
    return { ok: false, message };
  }
}
