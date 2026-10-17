import { lodLabel } from "../render/lod";
import type { AppState } from "../state/app";

export interface StatusItem {
  label: string;
  value: string;
}

const n = (v: number) => v.toLocaleString("en-US");

export function statusItems(s: AppState): StatusItem[] {
  const session = s.session;
  if (!session) return [];
  const c = session.counts;
  const cand = s.candidate;
  const current =
    cand &&
    cand.cloud_revision === session.revision.cloud &&
    cand.params_revision === session.revision.params
      ? cand
      : null;
  const pct = c.original > 0 ? (c.deleted / c.original) * 100 : 0;
  const job = s.job.busy
    ? `${s.job.message ?? "Working"}${s.job.progress !== null ? ` ${Math.round(s.job.progress * 100)}%` : ""}`
    : "Idle";
  return [
    { label: "Original", value: n(c.original) },
    { label: "Active", value: n(c.active) },
    { label: "Displayed", value: n(c.displayed) },
    { label: "Selected", value: n(c.selected) },
    { label: "Protected", value: n(c.protected) },
    { label: "Candidates", value: current ? n(current.candidates) : "—" },
    { label: "Invalid (active/total)", value: `${n(c.invalid_active)} / ${n(c.invalid_total)}` },
    { label: "Deleted", value: `${pct.toFixed(2)}%` },
    {
      label: "Rendered",
      value: s.render
        ? lodLabel({ count: s.render.count, eligible: s.render.eligible, budget: s.budget })
        : "—",
    },
    { label: "Unsaved", value: session.unsaved ? "Yes" : "No" },
    { label: "Job", value: job },
  ];
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** Always-visible mode, operation, scope, frame and unit text. */
export function modeIndicator(s: AppState): string {
  const tool = s.interaction === "pick-pivot" ? "Pick pivot" : s.interaction === "pick-floor" ? "Pick floor point" : s.interaction === "pick-slice" ? "Pick slice point" : cap(s.tool);
  const unit = s.session?.unit ?? "m";
  const view = s.compare === "edited" ? "" : ` · View: ${cap(s.compare)} (read-only)`;
  return `Tool: ${tool} · Op: ${cap(s.op)} · Scope: ${cap(s.scope)} · Frame: file (Z up) · Unit: ${unit} (assumed)${view}`;
}
