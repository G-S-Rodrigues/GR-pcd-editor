import { expect, test, vi } from "vitest";
import type { RenderData } from "../render/parse";
import { createAppStore } from "../state/app";
import { createRefresher } from "./refresh";

const data = (n: number): RenderData => ({
  coords: new Float32Array(n * 3),
  ids: new Uint32Array(n),
  flags: new Uint8Array(n),
  origin: [0, 0, 0],
  count: n,
  eligible: n,
  cloudRevision: 0,
  paramsRevision: 0,
});

test("UI-22 refresh is latest-wins: an older render resolving last is discarded", async () => {
  const store = createAppStore();
  const pending: ((d: RenderData) => void)[] = [];
  const fetchRender = vi.fn(
    () => new Promise<RenderData>((resolve) => pending.push(resolve)),
  );
  const r = createRefresher(store, fetchRender);
  const first = r.refresh();
  const second = r.refresh();
  pending[1](data(2));
  await second;
  expect(store.get().render?.count).toBe(2);
  pending[0](data(1));
  await first;
  expect(store.get().render?.count).toBe(2);
  expect(store.get().rendering).toBe(false);
});

test("UI-22 refresh aborts the previous request and passes mode, budget and colour attr", async () => {
  const store = createAppStore();
  store.set({
    renderMode: "original",
    budget: 1000,
    colour: { mode: "intensity", pointSize: 2 },
    session: { schema: [{ name: "intensity", type: "F", size: 4, count: 1 }] } as never,
  });
  const signals: AbortSignal[] = [];
  const fetchRender = vi.fn(async (_m: string, _b: number, _a: string | undefined, s?: AbortSignal) => {
    if (s) signals.push(s);
    return data(1);
  });
  const r = createRefresher(store, fetchRender);
  const p1 = r.refresh();
  const p2 = r.refresh();
  await Promise.all([p1, p2]);
  expect(fetchRender).toHaveBeenCalledWith("original", 1000, "intensity", expect.anything());
  expect(signals[0].aborted).toBe(true);
});

test("UI-22 a failed refresh reports a notice and keeps the previous render", async () => {
  const store = createAppStore();
  store.set({ render: data(3) });
  const r = createRefresher(store, async () => {
    throw new Error("boom");
  });
  expect(await r.refresh()).toBe(false);
  expect(store.get().render?.count).toBe(3);
  expect(store.get().notices.at(-1)?.code).toBe("render_failed");
});
