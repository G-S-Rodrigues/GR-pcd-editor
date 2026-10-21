import type { AppState } from "../state/app";

/** Render flag bits the server adds for a pending preview (bit 1 selected, 2 protected, 4 deleted). */
export const FLAG_PREVIEW_ADD = 8;
export const FLAG_PREVIEW_REMOVE = 16;

const n = (v: number) => v.toLocaleString("en-US");

/**
 * Text under the selection controls while an Add/Subtract/Intersect shape is drafted. A count is only
 * ever the server's; while a job runs there is none. The visible `text` is short; `title` carries the rest.
 */
export function previewParts(s: AppState): { text: string; title: string } | null {
  const p = s.preview;
  if (!s.draft && !p) return null;
  if (s.job.busy) return { text: "Computing preview...", title: "" };
  if (!p) {
    const text = s.previewLive
      ? "Preview not ready; edit the shape or press Commit draft to preview it."
      : "Live preview is off: the outline shows the shape. Press Commit draft to compute and apply it in one step.";
    return { text, title: text };
  }
  const apply = `Apply uses only those ${n(p.base_selected)} committed points.`;
  const title = `The selection is still ${n(p.base_selected)} points. ${apply} Press Commit draft to make the preview the selection; Esc discards.`;
  if (p.op === "add") return { text: `Preview, not applied: adding this shape would select ${n(p.selected_after)} points (${n(p.added)} new). ${apply}`, title };
  return { text: `Preview, not applied: this ${p.op} would leave ${n(p.selected_after)} selected (${n(p.removed)} removed). ${apply}`, title };
}

/** The visible draft note alone (see `previewParts`). */
export function previewText(s: AppState): string | null {
  return previewParts(s)?.text ?? null;
}

/** The cluster summary the Cluster panel shows: the pending preview's while one exists, else the candidate's. */
export function previewClusterOf(s: AppState): unknown {
  if (s.preview?.cluster !== undefined) return s.preview.cluster;
  return s.candidate?.cluster ?? null;
}

/**
 * `sel-commit` is usable only with a ready preview of the chosen operation (not while its job runs); with Live
 * preview off a draft is enough, Commit computes the preview first and commits that.
 */
export function commitEnabled(s: AppState): boolean {
  if (s.job.busy || !s.draft) return false;
  return s.previewLive ? s.preview !== null && s.preview.op === s.op : true;
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
