import type { AppState } from "../state/app";
import type { Scope, SelectionOp } from "../state/types";
import { toBoxTool } from "../tools/box/model";
import { toClusterTool } from "../tools/cluster/model";
import { NO_PLANE_REASON, toPlaneTool } from "../tools/plane/model";
import { toThinTool } from "../tools/thin/model";
import { toSparseTool } from "../tools/sparse/model";
import { toPrismTool } from "../tools/polygon/model";
import type { ToolBody } from "./tooltypes";

export interface SelectionRequest {
  cloud_revision: number;
  op: SelectionOp;
  scope: Scope;
  tool: ToolBody | null;
  evaluate_candidate: boolean;
}
export type BuildResult = { ok: true; body: SelectionRequest } | { ok: false; reason: string };

/** Add, Subtract and Intersect are drafts: nothing is sent until the explicit commit button. */
export const isDraftOp = (op: SelectionOp): boolean => op === "add" || op === "subtract" || op === "intersect";

/**
 * Whether a tool edit shows a live preview instead of committing: only an Add/Subtract/Intersect over an existing
 * selection, and never while the edits are the first selection (`liveFirst`: nothing to preview against).
 */
export const shouldPreview = (s: AppState): boolean => !s.liveFirst && isDraftOp(s.op) && (s.session?.selection.count ?? 0) > 0;

/**
 * Why Select displayed and Invert are refused now, or null when they are allowed. One place: later parts extend it.
 * They would replace the selection under an armed tool, whose next edit would overwrite the result.
 */
export function selectionDisabledReason(s: AppState): string | null {
  if (s.tool !== "none") return "Disarm the tool first (Clear selection, or press the tool again)";
  return null;
}

export const invertNote = (scope: Scope): string => `Inverts the selection relative to ${scope} points`;

export function currentTool(s: AppState): ToolBody | null {
  const t = s.tools;
  const box = toBoxTool(t.box);
  const prism = toPrismTool(t.polygon);
  if (s.tool === "box") return box;
  if (s.tool === "polygon") return prism;
  if (s.tool === "cluster") {
    const c = toClusterTool(t.cluster, box, prism);
    return c && { ...c, on_limit: "partial" as const };
  }
  if (s.tool === "sparse") return toSparseTool(t.sparse, box, prism);
  if (s.tool === "plane") return toPlaneTool(t.plane, s.planes.chosen, box, prism);
  if (s.tool === "thin") return toThinTool(t.thin, box, prism);
  return null;
}

export function buildSelection(s: AppState): BuildResult {
  if (!s.session) return { ok: false, reason: "No file is open" };
  const base = { cloud_revision: s.session.revision.cloud, op: (s.liveFirst ? "replace" : s.op) as SelectionOp, scope: s.scope, evaluate_candidate: true };
  if (s.tool === "none") return { ok: false, reason: "Choose a selection tool first" };
  const tool = currentTool(s);
  if (!tool) {
    const why =
      s.tool === "polygon"
        ? "Draw and close a valid polygon first"
        : s.tool === "cluster"
          ? "Pick a seed point and a valid radius first"
          : s.tool === "sparse"
            ? "Sparse points needs a radius above 0 (or empty) and at least 1 neighbour"
            : s.tool === "plane"
              ? NO_PLANE_REASON
              : s.tool === "thin"
                ? "Thin needs a distance of 0 or more (duplicates) or an edge above 0 (voxel grid)"
                : "The box is not valid";
    return { ok: false, reason: why };
  }
  return { ok: true, body: { ...base, tool } };
}

export const clearRequest = (s: AppState): { cloud_revision: number } => ({
  cloud_revision: s.session?.revision.cloud ?? 0,
});

export function scopeNotice(s: AppState): string | null {
  const n = s.candidate?.selected_outside_display_filter ?? 0;
  return s.scope === "active" && n > 0 ? `${n.toLocaleString("en-US")} selected points are outside the display filter` : null;
}
