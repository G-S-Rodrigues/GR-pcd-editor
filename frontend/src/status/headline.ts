import type { AppState } from "../state/app";

export interface Headline {
  willDelete: string;
  kept: string;
  keptCount: number;
  warning: string | null;
  /** Label of the one-click 'also delete the kept points' button, or null when nothing is kept. */
  deleteKeptLabel: string | null;
}

const n = (v: number) => v.toLocaleString("en-US");

/** Headline numbers beside Apply, from the current (non-stale) candidate only. */
export function headline(s: AppState): Headline {
  const c = s.candidate;
  const cur = c && s.session && c.cloud_revision === s.session.revision.cloud && c.params_revision === s.session.revision.params ? c : null;
  if (!cur) return { willDelete: "Will delete —", kept: "Kept by protection —", keptCount: 0, warning: null, deleteKeptLabel: null };
  const m = cur.protected_retained;
  return {
    willDelete: `Will delete ${n(cur.candidates)}`,
    kept: `Kept by protection ${n(m)}`,
    keptCount: m,
    warning:
      m > 0
        ? `${n(m)} selected ${m === 1 ? "point lies" : "points lie"} inside the protected interval and will be kept (ghosts in the floor slab?)`
        : null,
    deleteKeptLabel: m > 0 ? `Also delete the ${n(m)} kept ${m === 1 ? "point" : "points"} (this operation only)` : null,
  };
}
