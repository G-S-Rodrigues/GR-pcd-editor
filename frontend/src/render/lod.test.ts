import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOD_FLAGGED_CAP, LOD_IDLE_MS, LOD_INTERACT, createLodGate, lodIndex } from "./lod";

describe("interaction LOD index (7c-3)", () => {
  it("UI-162 a stride subsample stays within the cap, ascending, deterministic and spread over the whole range", () => {
    const n = 1_000_000;
    const a = lodIndex(n, LOD_INTERACT)!;
    expect(a.length).toBeLessThanOrEqual(LOD_INTERACT);
    expect(a.length).toBeGreaterThan(LOD_INTERACT * 0.9);
    expect(a[0]).toBe(0);
    expect(a[a.length - 1]).toBeGreaterThan(n - 10);
    for (let i = 1; i < a.length; i++) if (a[i] <= a[i - 1]) throw new Error(`not ascending at ${i}`);
    expect(Array.from(lodIndex(n, LOD_INTERACT)!.subarray(0, 50))).toEqual(Array.from(a.subarray(0, 50)));
    expect(lodIndex(n, LOD_INTERACT)!.length).toBe(a.length);
  });

  it("UI-162 flagged (selected, protected) points are always kept, once each, in order", () => {
    const n = 1_000_000;
    const flags = new Uint8Array(n);
    const flagged = [1, 3, 500_001, 777_777, 999_999];
    for (const i of flagged) flags[i] = i % 2 ? 1 : 2;
    const a = lodIndex(n, 150_000, flags)!;
    const set = new Set(a);
    for (const i of flagged) expect(set.has(i)).toBe(true);
    expect(set.size).toBe(a.length); // no duplicates (index 0 and others in both lists)
    for (let i = 1; i < a.length; i++) expect(a[i]).toBeGreaterThan(a[i - 1]);
    expect(a.length).toBeLessThanOrEqual(150_000 + flagged.length);
  });

  it("UI-162 a huge flagged set is thinned to the flagged cap; deleted-only flags do not count", () => {
    const n = 1_000_000;
    const flags = new Uint8Array(n).fill(1);
    const a = lodIndex(n, 150_000, flags)!;
    expect(a.length).toBeLessThanOrEqual(150_000 + LOD_FLAGGED_CAP);
    const del = new Uint8Array(n).fill(4);
    expect(lodIndex(n, 150_000, del)!.length).toBeLessThanOrEqual(150_000);
  });

  it("UI-162 a cloud within the cap needs no index", () => {
    expect(lodIndex(150_000, 150_000)).toBeNull();
    expect(lodIndex(10, 150_000, new Uint8Array(10))).toBeNull();
  });
});

describe("interaction LOD gate (7c-3)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("UI-163 the first camera move turns the LOD on at once; it restores 250 ms after the last move", () => {
    const seen: boolean[] = [];
    const gate = createLodGate((on) => seen.push(on));
    expect(LOD_IDLE_MS).toBe(250);
    expect(gate.active()).toBe(false);
    gate.cameraMoved();
    expect(gate.active()).toBe(true);
    expect(seen).toEqual([true]);
    vi.advanceTimersByTime(249);
    expect(gate.active()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(gate.active()).toBe(false);
    expect(seen).toEqual([true, false]);
  });

  it("UI-163 repeated moves extend the wait and notify only on the change", () => {
    const seen: boolean[] = [];
    const gate = createLodGate((on) => seen.push(on));
    gate.cameraMoved();
    vi.advanceTimersByTime(200);
    gate.cameraMoved();
    vi.advanceTimersByTime(200);
    gate.cameraMoved();
    vi.advanceTimersByTime(249);
    expect(gate.active()).toBe(true);
    expect(seen).toEqual([true]);
    vi.advanceTimersByTime(1);
    expect(seen).toEqual([true, false]);
    gate.cameraMoved();
    expect(seen).toEqual([true, false, true]);
  });

  it("UI-163 dispose cancels the pending restore", () => {
    const seen: boolean[] = [];
    const gate = createLodGate((on) => seen.push(on));
    gate.cameraMoved();
    gate.dispose();
    vi.advanceTimersByTime(1000);
    expect(seen).toEqual([true]);
  });
});
