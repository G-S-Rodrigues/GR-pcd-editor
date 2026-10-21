import { afterEach, describe, expect, it, vi } from "vitest";
import type { RenderData } from "../render/parse";
import { createAppStore } from "../state/app";
import type { HistoryEntry } from "../state/types";
import { emptyTimeline } from "../timeline/model";
import { sessionFixture } from "../testing/fixtures";
import { createStepView } from "./stepview";

const hist = (n: number) => ({
  entries: Array.from({ length: n }, (_, i): HistoryEntry => ({ index: i, sid: i + 10, tool: "box", name: null, kind: "delete", description: "d", count: (i + 1) * 10 })),
  cursor: n,
  can_undo: true,
  can_redo: false,
});
const data = (n: number): RenderData => ({
  coords: new Float32Array(n * 3),
  ids: new Uint32Array(n),
  flags: new Uint8Array(n),
  origin: [0, 0, 0],
  count: n,
  eligible: n,
  cloudRevision: 3,
  paramsRevision: 4,
  sessionId: "s1",
});
const mk = () => {
  vi.useFakeTimers();
  const store = createAppStore();
  store.set({ session: sessionFixture({ history: hist(3) }) });
  const fetchStep = vi.fn(async (sid: number, _budget: number, _signal: AbortSignal) => data(sid));
  const view = createStepView(store, fetchStep, { hoverMs: 120 });
  return { store, fetchStep, view };
};
const hover = (store: ReturnType<typeof createAppStore>, sid: number | null) =>
  store.update((s) => ({ ...s, timeline: { ...emptyTimeline(), hover: sid } }));

afterEach(() => vi.useRealTimers());

describe("step view reconcile, hover and idle load", () => {
  it("UI-282 a hover that starts while a job runs loads once the job has ended", async () => {
    const t = mk();
    t.store.set({ job: { busy: true, progress: null, message: "x" } });
    hover(t.store, 11);
    await vi.advanceTimersByTimeAsync(500);
    expect(t.fetchStep).not.toHaveBeenCalled();
    t.store.set({ job: { busy: false, progress: null, message: null } });
    await vi.advanceTimersByTimeAsync(130);
    expect(t.fetchStep).toHaveBeenCalledTimes(1);
    expect(t.store.get().stepRender?.count).toBe(11);
    t.view.dispose();
  });

  it("UI-282 a hover that starts while the render is refreshing loads when it finishes", async () => {
    const t = mk();
    t.store.set({ rendering: true });
    hover(t.store, 12);
    await vi.advanceTimersByTimeAsync(500);
    expect(t.fetchStep).not.toHaveBeenCalled();
    t.store.set({ rendering: false });
    await vi.advanceTimersByTimeAsync(130);
    expect(t.fetchStep).toHaveBeenCalledTimes(1);
    t.view.dispose();
  });

  it("UI-283 a hover that left during the job is never loaded", async () => {
    const t = mk();
    t.store.set({ job: { busy: true, progress: null, message: "x" } });
    hover(t.store, 11);
    hover(t.store, null);
    t.store.set({ job: { busy: false, progress: null, message: null } });
    await vi.advanceTimersByTimeAsync(500);
    expect(t.fetchStep).not.toHaveBeenCalled();
    t.view.dispose();
  });

  it("UI-284 the cache key includes the point budget: a new budget refetches", async () => {
    const t = mk();
    t.store.update((s) => ({ ...s, timeline: { ...emptyTimeline(), highlight: 10 } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.fetchStep).toHaveBeenCalledTimes(1);
    t.store.set({ budget: 200_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(t.fetchStep).toHaveBeenCalledTimes(2);
    expect(t.fetchStep.mock.calls[1][1]).toBe(200_000);
    t.view.dispose();
  });

  it("UI-285 reconcile drops a hover or rename of a step that vanished, and keeps live ones", async () => {
    const t = mk();
    t.store.update((s) => ({ ...s, timeline: { ...emptyTimeline(), hover: 12, renaming: 11 } }));
    t.store.update((s) => ({ ...s, session: sessionFixture({ history: hist(2) }) }));
    expect(t.store.get().timeline.hover).toBeNull();
    expect(t.store.get().timeline.renaming).toBe(11);
    t.view.dispose();
  });
});
