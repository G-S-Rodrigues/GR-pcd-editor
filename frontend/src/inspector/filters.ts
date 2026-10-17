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
  const schedule = () => debounce.call(() => void send());
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
    resetToCloud() {
      const b = store.get().session?.bounds;
      if (b) apply(resetToBounds(store.get().tools.filters, b));
    },
    resetAll() {
      apply(emptyFilter());
    },
  };
}
