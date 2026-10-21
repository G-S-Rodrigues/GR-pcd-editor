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

  it("UI-211 a continuous drag still sends at least every 250 ms (max wait), and the last value wins", async () => {
    const store = createAppStore();
    store.set({ session: sessionFixture() });
    const put = vi.fn(async (_b: unknown) => sessionFixture());
    const c = createProtectionController(store, { putProtection: put, onParamsChanged: () => undefined });
    for (let i = 0; i < 20; i++) {
      c.edit((m) => setGlobal(m, { enabled: true, min: 0, max: i + 1 }));
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(put.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(put.mock.calls.length).toBeLessThanOrEqual(6);
    await vi.advanceTimersByTimeAsync(400);
    expect((put.mock.calls.at(-1)![0] as { global: { max: number } }).global.max).toBe(20);
  });

  it("UI-986 flush sends a waiting edit at once and resolves after the answer; with nothing waiting it resolves without a call", async () => {
    const store = createAppStore();
    store.set({ session: sessionFixture() });
    const put = vi.fn(async (_b: unknown) => sessionFixture({ revision: { cloud: 3, params: 5 } }));
    const changed = vi.fn();
    const c = createProtectionController(store, { putProtection: put, onParamsChanged: changed });
    await c.flush();
    expect(put).not.toHaveBeenCalled();
    c.edit((m) => setGlobal(m, { enabled: true, min: -0.05, max: 0.05 }));
    expect(put).not.toHaveBeenCalled();
    await c.flush(); // no timer advance: the 150 ms debounce is skipped
    expect(put).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(put).toHaveBeenCalledTimes(1); // the cancelled timer does not send again
  });

  it("UI-987 flush waits for a request that is already on its way", async () => {
    const store = createAppStore();
    store.set({ session: sessionFixture() });
    let release: (s: ReturnType<typeof sessionFixture>) => void = () => undefined;
    const put = vi.fn(() => new Promise<ReturnType<typeof sessionFixture>>((r) => (release = r)));
    const c = createProtectionController(store, { putProtection: put, onParamsChanged: () => undefined });
    c.edit((m) => setGlobal(m, { enabled: true, min: -0.05, max: 0.05 }));
    await vi.advanceTimersByTimeAsync(150);
    expect(put).toHaveBeenCalledTimes(1);
    let done = false;
    void c.flush().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    release(sessionFixture());
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
  });

  it("UI-990 flush reports false for a rejected PUT (error reported once) and for an invalid setting, true otherwise", async () => {
    const store = createAppStore();
    store.set({ session: sessionFixture() });
    const put = vi.fn(async (_b: unknown): Promise<ReturnType<typeof sessionFixture>> => {
      throw new Error("The session changed");
    });
    const onError = vi.fn();
    const c = createProtectionController(store, { putProtection: put, onParamsChanged: () => undefined, onError });
    expect(await c.flush()).toBe(true); // nothing waiting, nothing in flight
    c.edit((m) => setGlobal(m, { enabled: true, min: -0.05, max: 0.05 }));
    expect(await c.flush()).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
    put.mockImplementation(async () => sessionFixture());
    c.edit((m) => setGlobal(m, { enabled: true, min: -0.05, max: 0.06 }));
    expect(await c.flush()).toBe(true);
    c.edit((m) => setLocal(setOperationMode(m, "override"), { min: 1, max: 2 })); // override without the acknowledgement
    const calls = put.mock.calls.length;
    expect(await c.flush()).toBe(false);
    expect(put.mock.calls.length).toBe(calls);
    expect(onError).toHaveBeenLastCalledWith(expect.objectContaining({ message: expect.stringContaining("acknowledge") }));
  });
});
