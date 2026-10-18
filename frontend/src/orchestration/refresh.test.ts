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
    colour: { mode: "turbo", pointSize: 2 },
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
  expect(fetchRender).toHaveBeenCalledWith("original", 1000, undefined, expect.anything());
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

test("UI-410 edited render requests carry preview=<id> only when a preview is set and the primary render is edited; a response without the header clears it and refetches once", async () => {
  const store = createAppStore();
  const prev = { id: "p9", op: "add" as const, selected_after: 2, base_selected: 1, added: 1, removed: 0 };
  const calls: unknown[][] = [];
  const fetchRender = vi.fn(async (...a: unknown[]) => {
    calls.push(a);
    return { ...data(1), previewId: a[5] === "p9" && fetchRender.mock.calls.length === 1 ? undefined : (a[5] as string | undefined) };
  });
  const r = createRefresher(store, fetchRender as never);
  store.set({ renderMode: "edited", preview: null });
  await r.refresh();
  expect(calls[0]).toHaveLength(4); // no preview argument at all
  calls.length = 0;
  fetchRender.mockClear();
  store.set({ preview: prev });
  await r.refresh();
  expect(calls).toHaveLength(2);
  expect(calls[0][5]).toBe("p9");
  expect(calls[1]).toHaveLength(4); // refetched once, without the stale id
  expect(store.get().preview).toBeNull();
  // another primary mode never sends it
  store.set({ renderMode: "original", preview: prev });
  calls.length = 0;
  await r.refresh();
  expect(calls.every((c) => c.length === 4)).toBe(true);
});
