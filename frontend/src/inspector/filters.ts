import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import type { Bounds, DisplayFilter, SessionState } from "../state/types";
import { createDebouncer } from "../orchestration/timing";

export type Axis = "x" | "y" | "z";
export interface AxisModel {
  enabled: boolean;
  min: number;
  max: number;
}
export type FilterModel = Record<Axis, AxisModel>;

export const FILTER_COPY = "A display filter hides points from the view; it does not delete them.";
export const AXES: Axis[] = ["x", "y", "z"];

export const emptyFilter = (): FilterModel => ({
  x: { enabled: false, min: 0, max: 0 },
  y: { enabled: false, min: 0, max: 0 },
  z: { enabled: false, min: 0, max: 0 },
});

export const filterFromState = (f: DisplayFilter): FilterModel => {
  const one = (a: DisplayFilter["x"]): AxisModel => ({ enabled: a.enabled, min: a.min ?? 0, max: a.max ?? 0 });
  return { x: one(f.x), y: one(f.y), z: one(f.z) };
};

export interface FilterEdit {
  ok: boolean;
  model: FilterModel;
  error?: string;
}

/** Limits are inclusive; a min above max (or a non-finite value) is rejected and the previous model kept. */
/** Enabling an untouched axis (0..0) starts from the cloud bounds, so the first min or max edit is valid. */
export function enableDefaults(m: FilterModel, axis: Axis, patch: Partial<AxisModel>, bounds: Bounds | null): Partial<AxisModel> {
  const cur = m[axis];
  if (!bounds || patch.enabled !== true || cur.enabled || cur.min !== 0 || cur.max !== 0) return patch;
  const i = AXES.indexOf(axis);
  return { min: bounds.min[i], max: bounds.max[i], ...patch };
}

export function setAxis(m: FilterModel, axis: Axis, patch: Partial<AxisModel>): FilterEdit {
  const next = { ...m[axis], ...patch };
  if (!Number.isFinite(next.min) || !Number.isFinite(next.max)) {
    return { ok: false, model: m, error: `${axis.toUpperCase()} limits must be finite numbers` };
  }
  if (next.min > next.max) return { ok: false, model: m, error: `${axis.toUpperCase()} min must not exceed max` };
  return { ok: true, model: { ...m, [axis]: next } };
}

export const toFilterBody = (m: FilterModel): DisplayFilter => ({
  x: { ...m.x },
  y: { ...m.y },
  z: { ...m.z },
});

export function resetToBounds(_m: FilterModel, b: Bounds): FilterModel {
  return {
    x: { enabled: false, min: b.min[0], max: b.max[0] },
    y: { enabled: false, min: b.min[1], max: b.max[1] },
    z: { enabled: false, min: b.min[2], max: b.max[2] },
  };
}
export const resetAll = (_m: FilterModel): FilterModel => emptyFilter();

export type Side = "min" | "max";

/**
 * A side is active iff its value lies strictly inside the cloud bounds (min: above bounds.min, max: below bounds.max).
 * No wire field: an inactive side sends the cloud bound, which the inclusive backend filter keeps (API-72).
 */
export function sideActive(m: FilterModel, b: Bounds | null, axis: Axis, side: Side): boolean {
  if (!b || !m[axis].enabled) return false;
  const i = AXES.indexOf(axis);
  return side === "min" ? m[axis].min > b.min[i] : m[axis].max < b.max[i];
}

/** The value a side shows: its limit when active, else the cloud bound (0 without a cloud). */
export function sideValue(m: FilterModel, b: Bounds | null, axis: Axis, side: Side): number {
  if (!b) return m[axis][side];
  const i = AXES.indexOf(axis);
  if (sideActive(m, b, axis, side)) return m[axis][side];
  return side === "min" ? b.min[i] : b.max[i];
}

export const activeSides = (m: FilterModel, b: Bounds | null): number =>
  AXES.reduce((n, a) => n + Number(sideActive(m, b, a, "min")) + Number(sideActive(m, b, a, "max")), 0);

/** Sets one side. Values clamp to the cloud bounds; both sides back at the bounds disable the axis. */
export function setSide(m: FilterModel, b: Bounds | null, axis: Axis, side: Side, value: number): FilterEdit {
  if (!b) return { ok: false, model: m, error: "Open a cloud first" };
  if (!Number.isFinite(value)) return { ok: false, model: m, error: `${axis.toUpperCase()} ${side} must be a finite number` };
  const i = AXES.indexOf(axis);
  const v = Math.min(Math.max(value, b.min[i]), b.max[i]);
  const lo = side === "min" ? v : sideValue(m, b, axis, "min");
  const hi = side === "max" ? v : sideValue(m, b, axis, "max");
  if (lo > hi) return { ok: false, model: m, error: `${axis.toUpperCase()} min must not exceed max` };
  const both = lo <= b.min[i] && hi >= b.max[i];
  return { ok: true, model: { ...m, [axis]: { enabled: !both, min: lo, max: hi } } };
}

export function resetSide(m: FilterModel, b: Bounds | null, axis: Axis, side: Side): FilterEdit {
  if (!b) return { ok: false, model: m, error: "Open a cloud first" };
  const i = AXES.indexOf(axis);
  return setSide(m, b, axis, side, side === "min" ? b.min[i] : b.max[i]);
}

/** "N filters active, X% hidden": hidden is the share of active points the filters hide. */
export function filterSummary(m: FilterModel, b: Bounds | null, counts: { active: number; displayed: number }): string {
  const n = activeSides(m, b);
  const pct = counts.active > 0 ? `${(((counts.active - counts.displayed) / counts.active) * 100).toFixed(1)}%` : "0%";
  return `${n} ${n === 1 ? "filter" : "filters"} active, ${pct} hidden`;
}

export const selectDisplayedBody = (cloud_revision: number) => ({
  cloud_revision,
  op: "replace" as const,
  scope: "displayed" as const,
  tool: { type: "filter" as const },
  evaluate_candidate: true,
});

export interface FilterDeps {
  putFilter: (b: DisplayFilter) => Promise<SessionState>;
  /** Called after the server accepted a filter change (the candidate must be recomputed). */
  onParamsChanged: () => void;
  onError?: (e: unknown) => void;
}

/** Debounced filter edits: one PUT (latest wins), candidate cleared immediately. */
export function createFilterController(store: Store<AppState>, deps: FilterDeps) {
  const debounce = createDebouncer(150);
  // a pointer drag shows the cut while moving: send at least every 250 ms
  const liveDebounce = createDebouncer(150, { maxWaitMs: 250 });
  let gen = 0;
  const send = async () => {
    const mine = ++gen;
    try {
      const state = await deps.putFilter(toFilterBody(store.get().tools.filters));
      if (mine !== gen) return;
      store.set({ session: state });
      deps.onParamsChanged();
    } catch (e) {
      deps.onError?.(e);
    }
  };
  const schedule = () => {
    liveDebounce.cancel();
    debounce.call(() => void send());
  };
  const sendNow = () => {
    debounce.cancel();
    liveDebounce.cancel();
    void send();
  };
  const sideEdit = (r: FilterEdit, live: boolean): FilterEdit => {
    if (!r.ok) return r;
    store.update((s) => ({ ...s, candidate: null, tools: { ...s.tools, filters: r.model } }));
    if (live) {
      debounce.cancel();
      liveDebounce.call(() => void send());
    } else sendNow();
    return r;
  };
  const apply = (next: FilterModel) => {
    store.update((s) => ({ ...s, candidate: null, tools: { ...s.tools, filters: next } }));
    schedule();
  };
  return {
    edit(axis: Axis, patch: Partial<AxisModel>): FilterEdit {
      const r = setAxis(store.get().tools.filters, axis, patch);
      if (r.ok) apply(r.model);
      return r;
    },
    /** One side of one box. `live` is a drag in progress (throttled); otherwise (release, Enter) the PUT goes at once. */
    editSide(axis: Axis, side: Side, value: number, opts: { live: boolean }): FilterEdit {
      const s = store.get();
      return sideEdit(setSide(s.tools.filters, s.session?.bounds ?? null, axis, side, value), opts.live);
    },
    resetSide(axis: Axis, side: Side): FilterEdit {
      const s = store.get();
      return sideEdit(resetSide(s.tools.filters, s.session?.bounds ?? null, axis, side), false);
    },
    resetToCloud() {
      const b = store.get().session?.bounds;
      if (b) apply(resetToBounds(store.get().tools.filters, b));
    },
    resetAll() {
      apply(emptyFilter());
    },
  };
}
