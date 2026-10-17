import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppStore } from "../state/app";
import { candidateFixture, sessionFixture } from "../testing/fixtures";
import { acknowledge, setGlobal, setLocal, setOperationMode } from "./protection";
import { createProtectionController } from "./protection-controller";

describe("protection controller", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("UI-56 debounced PUT with the global key; candidate cleared at once; params-changed after the answer", async () => {
    const store = createAppStore();
    store.set({ session: sessionFixture(), candidate: candidateFixture() });
    const put = vi.fn(async (_b: unknown) => sessionFixture({ revision: { cloud: 3, params: 5 } }));
    const changed = vi.fn();
    const c = createProtectionController(store, { putProtection: put, onParamsChanged: changed });
    c.edit((m) => setGlobal(m, { enabled: true, min: 0, max: 1 }));
    c.edit((m) => setGlobal(m, { max: 2 }));
    expect(store.get().candidate).toBeNull();
    expect(put).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    expect(put).toHaveBeenCalledTimes(1);
    expect((put.mock.calls[0][0] as { global: unknown }).global).toEqual({ enabled: true, min: 0, max: 2 });
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("UI-57 override without acknowledgement sends nothing and blocks apply", async () => {
    const store = createAppStore();
    store.set({ session: sessionFixture() });
    const put = vi.fn(async (_b: unknown) => sessionFixture());
    const c = createProtectionController(store, { putProtection: put, onParamsChanged: () => undefined });
    c.edit((m) => setLocal(setOperationMode(m, "override"), { min: 1, max: 2 }));
    await vi.advanceTimersByTimeAsync(500);
    expect(put).not.toHaveBeenCalled();
    c.edit((m) => ({ ok: true, model: acknowledge(m, true) }));
    await vi.advanceTimersByTimeAsync(150);
    expect(put).toHaveBeenCalledTimes(1);
    expect((put.mock.calls[0][0] as { operation: { acknowledge_override: boolean } }).operation.acknowledge_override).toBe(true);
  });

  it("an invalid edit keeps the previous model", () => {
    const store = createAppStore();
    store.set({ session: sessionFixture() });
    const c = createProtectionController(store, { putProtection: async () => sessionFixture(), onParamsChanged: () => undefined });
    const before = store.get().tools.protection;
    const r = c.edit((m) => setGlobal(m, { enabled: true, min: 5, max: 1 }));
    expect(r.ok).toBe(false);
    expect(store.get().tools.protection).toBe(before);
  });
});
