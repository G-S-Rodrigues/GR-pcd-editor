import { DELETED_OPACITY_DEFAULT, type RenderTheme, paletteFor } from "../colour/palette";
import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import type { Counts, RenderMode } from "../state/types";

export type CompareMode = "original" | "edited" | "overlay" | "split";
export const COMPARE_MODES: CompareMode[] = ["original", "edited", "overlay", "split"];
export const READ_ONLY_REASON = "Return to the edited view to edit";

/** Which renders a comparison mode needs; `primary` also feeds picking and the single view. */
export function fetchPlan(mode: CompareMode): { primary: RenderMode; secondary: RenderMode | null } {
  switch (mode) {
    case "original":
      return { primary: "original", secondary: null };
    case "edited":
      return { primary: "edited", secondary: null };
    case "overlay":
      return { primary: "edited", secondary: "deleted" };
    case "split":
      return { primary: "original", secondary: "edited" };
  }
}

export const clampOpacity = (v: number | undefined): number =>
  v === undefined || !Number.isFinite(v) ? DELETED_OPACITY_DEFAULT : Math.min(1, Math.max(0.05, v));

export const overlayStyle = (opacity: number | undefined, theme: RenderTheme = "dark") => ({
  colour: paletteFor(theme).deleted,
  opacity: clampOpacity(opacity),
});

export function countsPanel(c: Counts) {
  const deleted = c.original - c.active;
  const pct = c.original > 0 ? (deleted / c.original) * 100 : 0;
  return { original: c.original, remaining: c.active, deleted, deletedPercent: `${pct.toFixed(2)}%` };
}

export function editAllowed(mode: CompareMode): { ok: true } | { ok: false; reason: string } {
  return mode === "edited" ? { ok: true } : { ok: false, reason: READ_ONLY_REASON };
}

/** Switches the comparison mode; the caller refreshes the renders afterwards. */
export function setCompare(store: Store<AppState>, mode: CompareMode): void {
  store.update((s) => ({
    ...s,
    compare: mode,
    renderMode: fetchPlan(mode).primary,
    render2: null,
    ...(mode === "edited" ? {} : { interaction: "orbit" as const }),
  }));
}

/** Cache key for a fetched render: session identity and selection identity (not count) because flags depend on them. */
export function renderCacheKey(s: AppState, mode: RenderMode, attr?: string): string {
  const r = s.session?.revision;
  return [s.session?.session_id, r?.cloud, r?.params, s.session?.selection?.id, s.budget, mode, attr ?? ""].join("|");
}
