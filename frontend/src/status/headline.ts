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
  const byLayers = Math.min(cur.protected_by_layers ?? 0, m);
  const band = m - byLayers;
  return {
    willDelete: `Will delete ${n(cur.candidates)}`,
    kept: `Kept by protection ${n(m)}`,
    keptCount: m,
    warning:
      m <= 0
        ? null
        : byLayers > 0
          ? `${n(m)} selected ${m === 1 ? "point" : "points"} will be kept by protection (${n(byLayers)} in protected layers)`
          : `${n(m)} selected ${m === 1 ? "point lies" : "points lie"} inside the protected interval and will be kept (ghosts in the floor slab?)`,
    // a protected layer is never deleted, so only the band-kept points are offered
    deleteKeptLabel: band > 0 ? `Also delete the ${n(band)} kept ${band === 1 ? "point" : "points"} (this operation only)` : null,
  };
}
