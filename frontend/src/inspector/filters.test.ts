import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppStore } from "../state/app";
import { candidateFixture, sessionFixture } from "../testing/fixtures";
import {
  FILTER_COPY,
  createFilterController,
  emptyFilter,
  filterFromState,
  resetAll,
  resetToBounds,
  selectDisplayedBody,
  setAxis,
  toFilterBody,
} from "./filters";

describe("filters model", () => {
  it("UI-52 maps six fields 1:1, rejects min>max, resets", () => {
    let m = emptyFilter();
    const r = setAxis(m, "z", { enabled: true, min: -1, max: 2 });
    expect(r.ok).toBe(true);
    m = r.model;
    expect(toFilterBody(m)).toEqual({
      x: { enabled: false, min: 0, max: 0 },
      y: { enabled: false, min: 0, max: 0 },
      z: { enabled: true, min: -1, max: 2 },
    });
    const bad = setAxis(m, "z", { min: 5 });
    expect(bad.ok).toBe(false);
    expect(bad.model).toBe(m);
    expect(setAxis(m, "x", { max: NaN }).ok).toBe(false);
    // inclusive limits: equal min and max is valid
    expect(setAxis(m, "x", { enabled: true, min: 1, max: 1 }).ok).toBe(true);
    // per-axis disable keeps the numbers
    expect(setAxis(m, "z", { enabled: false }).model.z).toEqual({ enabled: false, min: -1, max: 2 });
    const rb = resetToBounds(m, { min: [0, 1, 2], max: [3, 4, 5] });
    expect(rb.x).toEqual({ enabled: false, min: 0, max: 3 });
    expect(rb.z).toEqual({ enabled: false, min: 2, max: 5 });
    expect(resetAll(m)).toEqual(emptyFilter());
    expect(filterFromState(sessionFixture().display_filter)).toEqual(emptyFilter());
  });

  it("UI-53 Select displayed request and copy", () => {
    expect(selectDisplayedBody(7)).toEqual({
      cloud_revision: 7,
      op: "replace",
      scope: "displayed",
      tool: { type: "filter" },
      evaluate_candidate: true,
    });
    expect(FILTER_COPY).toMatch(/hides points/i);
    expect(FILTER_COPY).toMatch(/does not delete/i);
  });
});

describe("filter controller", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("UI-54 debounces 150 ms to one PUT with the latest value; clears the candidate at once", async () => {
    const store = createAppStore();
    store.set({ session: sessionFixture(), candidate: candidateFixture() });
    const put = vi.fn(async (_b: unknown) => sessionFixture({ revision: { cloud: 3, params: 5 } }));
    const changed = vi.fn();
    const c = createFilterController(store, { putFilter: put, onParamsChanged: changed });
    c.edit("z", { enabled: true, min: 0, max: 1 });
    expect(store.get().candidate).toBeNull();
    c.edit("z", { max: 2 });
    c.edit("z", { max: 3 });
    expect(put).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    expect(put).toHaveBeenCalledTimes(1);
    expect((put.mock.calls[0][0] as { z: unknown }).z).toEqual({ enabled: true, min: 0, max: 3 });
    expect(store.get().session?.revision.params).toBe(5);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("UI-54 an invalid edit keeps the previous values and sends nothing", async () => {
    const store = createAppStore();
    store.set({ session: sessionFixture() });
    const put = vi.fn(async (_b: unknown) => sessionFixture());
    const c = createFilterController(store, { putFilter: put, onParamsChanged: () => undefined });
    c.edit("x", { enabled: true, min: 0, max: 5 });
    const before = store.get().tools.filters;
    const r = c.edit("x", { min: 9 });
    expect(r.ok).toBe(false);
    expect(store.get().tools.filters).toBe(before);
    await vi.advanceTimersByTimeAsync(150);
    expect((put.mock.calls[0][0] as { x: unknown }).x).toEqual({ enabled: true, min: 0, max: 5 });
  });
});
