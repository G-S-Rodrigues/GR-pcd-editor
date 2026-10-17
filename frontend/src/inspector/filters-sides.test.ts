import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppStore } from "../state/app";
import type { Bounds } from "../state/types";
import { candidateFixture, sessionFixture } from "../testing/fixtures";
import {
  createFilterController,
  emptyFilter,
  filterFromState,
  filterSummary,
  resetSide,
  setSide,
  sideActive,
  sideValue,
  toFilterBody,
} from "./filters";

const B: Bounds = { min: [0, -5, 2], max: [10, 5, 12] };

describe("filter sides", () => {
  it("UI-190 a side is active only strictly inside the cloud bounds; state restores by the same rule", () => {
    const m = filterFromState({
      x: { enabled: true, min: 2, max: 10 },
      y: { enabled: false, min: -3, max: 3 },
      z: { enabled: true, min: 2, max: 12 },
    });
    expect(sideActive(m, B, "x", "min")).toBe(true);
    expect(sideActive(m, B, "x", "max")).toBe(false); // equals the bound
    expect(sideActive(m, B, "y", "min")).toBe(false); // axis disabled
    expect(sideActive(m, B, "z", "min")).toBe(false);
    expect(sideActive(m, B, "z", "max")).toBe(false);
    expect(sideActive(m, null, "x", "min")).toBe(false);
    expect(sideValue(m, B, "x", "min")).toBe(2);
    expect(sideValue(m, B, "x", "max")).toBe(10);
    expect(sideValue(m, B, "y", "min")).toBe(-5); // inactive shows the cloud bound
    expect(sideValue(emptyFilter(), null, "y", "max")).toBe(0);
  });

  it("UI-191 setSide activates an axis, keeps the other side at its bound, and disables it when both return", () => {
    const a = setSide(emptyFilter(), B, "z", "min", 4);
    expect(a.ok).toBe(true);
    expect(toFilterBody(a.model).z).toEqual({ enabled: true, min: 4, max: 12 });
    expect(sideActive(a.model, B, "z", "max")).toBe(false);
    const b = setSide(a.model, B, "z", "max", 9);
    expect(toFilterBody(b.model).z).toEqual({ enabled: true, min: 4, max: 9 });
    const c = setSide(b.model, B, "z", "min", 2);
    expect(toFilterBody(c.model).z).toEqual({ enabled: true, min: 2, max: 9 });
    const d = setSide(c.model, B, "z", "max", 12);
    expect(toFilterBody(d.model).z).toEqual({ enabled: false, min: 2, max: 12 });
    // values outside the cloud clamp to the bound
    expect(sideValue(setSide(emptyFilter(), B, "x", "min", -50).model, B, "x", "min")).toBe(0);
    // rejected: min above max, non-finite; the previous model is kept
    expect(setSide(b.model, B, "z", "min", 10).ok).toBe(false);
    expect(setSide(b.model, B, "z", "min", 10).model).toBe(b.model);
    expect(setSide(b.model, B, "z", "max", NaN).ok).toBe(false);
    expect(setSide(emptyFilter(), null, "z", "max", 3).ok).toBe(false);
  });

  it("UI-192 resetSide returns one side to its bound; summary counts active sides and the hidden share", () => {
    let m = setSide(emptyFilter(), B, "x", "min", 3).model;
    m = setSide(m, B, "x", "max", 8).model;
    m = setSide(m, B, "z", "min", 5).model;
    const r = resetSide(m, B, "x", "min");
    expect(r.ok).toBe(true);
    expect(sideActive(r.model, B, "x", "min")).toBe(false);
    expect(sideActive(r.model, B, "x", "max")).toBe(true);
    expect(filterSummary(emptyFilter(), B, { active: 900, displayed: 900 })).toBe("0 filters active, 0.0% hidden");
    expect(filterSummary(r.model, B, { active: 1000, displayed: 750 })).toBe("2 filters active, 25.0% hidden");
    const one = setSide(emptyFilter(), B, "y", "max", 0).model;
    expect(filterSummary(one, B, { active: 10, displayed: 5 })).toBe("1 filter active, 50.0% hidden");
    expect(filterSummary(m, B, { active: 10, displayed: 0 })).toBe("3 filters active, 100.0% hidden");
    expect(filterSummary(m, B, { active: 0, displayed: 0 })).toBe("3 filters active, 0% hidden");
  });
});

describe("filter controller sides", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    const store = createAppStore();
    store.set({ session: sessionFixture({ bounds: B }), candidate: candidateFixture() });
    const put = vi.fn(async (_b: unknown) => sessionFixture({ bounds: B, revision: { cloud: 3, params: 9 } }));
    const changed = vi.fn();
    const c = createFilterController(store, { putFilter: put, onParamsChanged: changed });
    return { store, put, changed, c };
  };

  it("UI-193 a live drag sends at least one PUT per 250 ms, the release sends the final value at once, the candidate clears at once", async () => {
    const { store, put, c } = setup();
    for (let i = 1; i <= 50; i++) {
      const r = c.editSide("z", "min", 2 + i * 0.1, { live: true });
      expect(r.ok).toBe(true);
      if (i === 1) expect(store.get().candidate).toBeNull();
      await vi.advanceTimersByTimeAsync(20);
    }
    expect(put.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(put.mock.calls.length).toBeLessThanOrEqual(6);
    const before = put.mock.calls.length;
    c.editSide("z", "min", 9, { live: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(put.mock.calls.length).toBe(before + 1);
    expect((put.mock.calls[before][0] as { z: unknown }).z).toEqual({ enabled: true, min: 9, max: 12 });
  });

  it("UI-193 a stale response is ignored", async () => {
    const store = createAppStore();
    store.set({ session: sessionFixture({ bounds: B }) });
    const resolvers: ((s: ReturnType<typeof sessionFixture>) => void)[] = [];
    const put = vi.fn(() => new Promise<ReturnType<typeof sessionFixture>>((res) => resolvers.push(res)));
    const changed = vi.fn();
    const c = createFilterController(store, { putFilter: put as never, onParamsChanged: changed });
    c.editSide("x", "max", 5, { live: false });
    c.editSide("x", "max", 6, { live: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(put).toHaveBeenCalledTimes(2);
    resolvers[1](sessionFixture({ bounds: B, revision: { cloud: 3, params: 22 } }));
    await vi.advanceTimersByTimeAsync(0);
    resolvers[0](sessionFixture({ bounds: B, revision: { cloud: 3, params: 21 } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.get().session?.revision.params).toBe(22);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("UI-193 resetSide sends the side at its bound; an invalid value changes nothing", async () => {
    const { store, put, c } = setup();
    c.editSide("y", "min", -2, { live: false });
    await vi.advanceTimersByTimeAsync(0);
    c.resetSide("y", "min");
    await vi.advanceTimersByTimeAsync(0);
    expect((put.mock.calls[1][0] as { y: unknown }).y).toEqual({ enabled: false, min: -5, max: 5 });
    c.editSide("y", "min", 1, { live: false });
    await vi.advanceTimersByTimeAsync(0);
    const before = store.get().tools.filters;
    expect(c.editSide("y", "max", 0, { live: false }).ok).toBe(false);
    expect(store.get().tools.filters).toBe(before);
    await vi.advanceTimersByTimeAsync(500);
    expect(put).toHaveBeenCalledTimes(3);
  });
});
