import { postJson } from "./http";
import { pollJob, type PollOptions } from "./jobs";

export type ExportFormat = "binary" | "ascii";
export type ExportScope = "active" | "selected" | "displayed";

export interface Download {
  url: string;
  filename: string;
}

/** Starts a browser download without loading the file into memory. */
export function triggerDownload(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function startExport(
  format: ExportFormat,
  scope: ExportScope,
  opts: PollOptions = {},
): Promise<Download> {
  const job = await postJson<{ id: string }>("/api/session/export", { format, scope });
  const res = await pollJob<{ export_id: string; filename: string }>(job.id, opts);
  const dl = { url: `/api/exports/${res.export_id}`, filename: res.filename };
  triggerDownload(dl.url, dl.filename);
  return dl;
}

/** Saves the session archive. Does not mark it saved: the UI does that. */
export async function startSave(opts: PollOptions = {}): Promise<Download & { archiveId: string }> {
  const job = await postJson<{ id: string }>("/api/session/save", {});
  const res = await pollJob<{ archive_id: string; filename: string }>(job.id, opts);
  const dl = {
    url: `/api/session-archives/${res.archive_id}`,
    filename: res.filename,
    archiveId: res.archive_id,
  };
  triggerDownload(dl.url, dl.filename);
  return dl;
}

/** Call after the download started ("download started", not "saved"). */
export function markSaved<T = unknown>(archiveId: string): Promise<T> {
  return postJson<T>("/api/session/mark-saved", { archive_id: archiveId });
}
