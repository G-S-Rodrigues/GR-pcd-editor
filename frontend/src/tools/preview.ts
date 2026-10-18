import type { AppState } from "../state/app";

/** Render flag bits the server adds for a pending preview (bit 1 selected, 2 protected, 4 deleted). */
export const FLAG_PREVIEW_ADD = 8;
export const FLAG_PREVIEW_REMOVE = 16;

const n = (v: number) => v.toLocaleString("en-US");

/**
 * Text under the selection controls while an Add/Subtract/Intersect shape is drafted. A count is only
 * ever the server's; while a job runs there is none.
 */
export function previewText(s: AppState): string | null {
  const p = s.preview;
  if (!s.draft && !p) return null;
  if (s.job.busy) return "Computing preview...";
  if (!p) return "Preview not ready; edit the shape or press Commit draft to preview it.";
  const keep = `The selection is still ${n(p.base_selected)} points. Apply uses only those ${n(p.base_selected)} committed points. Press Commit draft to make the preview the selection; Esc discards.`;
  if (p.op === "add") {
    return `Preview, not applied: adding this shape would select ${n(p.selected_after)} points (${n(p.added)} new). ${keep}`;
  }
  return `Preview, not applied: this ${p.op} would leave ${n(p.selected_after)} selected (${n(p.removed)} removed). ${keep}`;
}

/** The cluster summary the Cluster panel shows: the pending preview's while one exists, else the candidate's. */
export function previewClusterOf(s: AppState): unknown {
  if (s.preview?.cluster !== undefined) return s.preview.cluster;
  return s.candidate?.cluster ?? null;
}

/** `sel-commit` is usable only with a ready preview of the chosen operation (not while its job runs). */
export function commitEnabled(s: AppState): boolean {
  return s.draft && s.preview !== null && s.preview.op === s.op && !s.job.busy;
}

/** Label of `sel-commit`: names the previewed change once there is one ("Commit: add 123 points"). */
export function commitLabel(s: AppState): string {
  const p = s.preview;
  if (!s.draft || !p || p.op !== s.op) return s.draft ? `Commit: ${s.op} tool shape` : "Commit draft";
  return `Commit: ${p.op === "add" ? "add" : "remove"} ${(p.op === "add" ? p.added : p.removed).toLocaleString("en-US")} points`;
}

/** `sel-discard` is usable while there is a draft or a preview to drop. */
export function discardEnabled(s: AppState): boolean {
  return s.draft || s.preview !== null;
}
