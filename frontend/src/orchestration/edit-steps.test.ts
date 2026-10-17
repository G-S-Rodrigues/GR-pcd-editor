import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../files/errors";
import type { RenderData } from "../render/parse";
import { createAppStore } from "../state/app";
import type { HistoryEntry } from "../state/types";
import { emptyTimeline } from "../timeline/model";
import { candidateFixture, sessionFixture } from "../testing/fixtures";
import { createEditor } from "./edit";
import { createStepView } from "./stepview";

const hist = (n: number, cursor = n) => ({
  entries: Array.from({ length: n }, (_, i): HistoryEntry => ({ index: i, sid: i + 10, tool: "box", name: null, kind: "delete", description: `Delete ${(i + 1) * 10} points (box)`, count: (i + 1) * 10 })),
  cursor,
  can_undo: cursor > 0,
  can_redo: cursor < n,
});

function setup(cursor = 3) {
  const store = createAppStore();
  store.set({ session: sessionFixture({ history: hist(3, cursor) }), tool: "box", candidate: candidateFixture() });
  const next = (over = {}) => sessionFixture({ revision: { cloud: 4, params: 5 }, history: hist(3, 1), ...over });
  const api = {
    apply: vi.fn(async () => next()),
    undo: vi.fn(async () => next()),
    redo: vi.fn(async () => next()),
    removeInvalid: vi.fn(async () => next()),
    clearSelection: vi.fn(async () => next()),
    rollback: vi.fn(async (_r: number, _c: number) => next()),
    deleteStep: vi.fn(async (_r: number, _s: number) => next({ history: hist(2, 2) })),
    renameStep: vi.fn(async (_s: number, _n: string) => next({ revision: { cloud: 3, params: 4 } })),
    refreshState: vi.fn(async () => undefined),
    refreshRender: vi.fn(async () => true),
  };
  const confirm = vi.fn(() => true);
  return { store, api, confirm, ed: createEditor(store, api, confirm) };
}

describe("editor step actions", () => {
  it("UI-269 rollback sends the revision and the cursor, then refreshes state and render", async () => {
    const t = setup();
    await t.ed.rollback(1);
    expect(t.api.rollback).toHaveBeenCalledWith(3, 1);
    expect(t.api.refreshRender).toHaveBeenCalled();
    expect(t.store.get().session?.history.cursor).toBe(1);
    expect(t.store.get().candidate).toBeNull();
  });

  it("UI-269 rollback to the current cursor and while a job runs make no call", async () => {
    const t = setup();
    await t.ed.rollback(3);
    t.store.set({ job: { busy: true, progress: null, message: null } });
    await t.ed.rollback(1);
    await t.ed.deleteStep(11);
    expect(t.api.rollback).not.toHaveBeenCalled();
    expect(t.api.deleteStep).not.toHaveBeenCalled();
  });

  it("UI-269 a 409 reloads the state with a notice instead of throwing", async () => {
    const t = setup();
    t.api.rollback.mockRejectedValueOnce(new ApiError(409, "stale_revision", "old"));
    await t.ed.rollback(1);
    expect(t.api.refreshState).toHaveBeenCalled();
    expect(t.store.get().notices.map((n) => n.code)).toContain("stale_revision");
  });

  it("UI-270 deleteStep asks first (exact text), cancel makes no call, accept sends sid and refreshes", async () => {
    const t = setup();
    t.confirm.mockReturnValueOnce(false);
    await t.ed.deleteStep(11);
    expect(t.api.deleteStep).not.toHaveBeenCalled();
    expect(t.confirm).toHaveBeenCalledWith('Remove step "Box 2"? Its 20 points come back (or stay active if rolled back); later steps are kept. This cannot be undone. Continue?');
    await t.ed.deleteStep(11);
    expect(t.api.deleteStep).toHaveBeenCalledWith(3, 11);
    expect(t.api.refreshRender).toHaveBeenCalled();
    expect(t.store.get().session?.history.entries).toHaveLength(2);
  });

  it("UI-271 rename keeps the candidate and does not refresh the render (no cloud change)", async () => {
    const t = setup();
    await t.ed.renameStep(11, "Mirror");
    expect(t.api.renameStep).toHaveBeenCalledWith(11, "Mirror");
    expect(t.api.refreshRender).not.toHaveBeenCalled();
    expect(t.store.get().candidate).not.toBeNull();
  });
});

describe("apply while rolled back", () => {
  it("UI-272 asks with the discard text, cancel aborts with no API call, accept proceeds", async () => {
    const t = setup(1);
    t.confirm.mockReturnValueOnce(false);
    await t.ed.apply();
    expect(t.confirm).toHaveBeenCalledWith("Applying a new deletion discards the 2 rolled-back step(s) after the marker (they cannot be redone). Continue?");
    expect(t.api.apply).not.toHaveBeenCalled();
    await t.ed.apply();
    expect(t.api.apply).toHaveBeenCalledTimes(1);
  });

  it("UI-272 no extra prompt when nothing is rolled back", async () => {
    const t = setup(3);
    await t.ed.apply();
    expect(t.confirm).not.toHaveBeenCalled();
    expect(t.api.apply).toHaveBeenCalledTimes(1);
  });
});

const data = (n: number, sid = "s1"): RenderData => ({
  coords: new Float32Array(n * 3),
  ids: new Uint32Array(n),
  flags: new Uint8Array(n),
  origin: [0, 0, 0],
  count: n,
  eligible: n,
  cloudRevision: 3,
  paramsRevision: 4,
  sessionId: sid,
});

describe("step view fetch", () => {
  const mk = (fetchStep = vi.fn(async (sid: number) => data(sid))) => {
    vi.useFakeTimers();
    const store = createAppStore();
    store.set({ session: sessionFixture({ history: hist(3) }) });
    const view = createStepView(store, fetchStep, { hoverMs: 120 });
    return { store, fetchStep, view };
  };

  it("UI-273 a click fetches immediately with mode step; clearing the highlight drops the render", async () => {
    const t = mk();
    t.store.update((s) => ({ ...s, timeline: { ...emptyTimeline(), highlight: 11 } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.fetchStep).toHaveBeenCalledTimes(1);
    expect(t.fetchStep.mock.calls[0][0]).toBe(11);
    expect(t.store.get().stepRender?.count).toBe(11);
    t.store.update((s) => ({ ...s, timeline: emptyTimeline() }));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.store.get().stepRender).toBeNull();
    t.view.dispose();
    vi.useRealTimers();
  });

  it("UI-273 hover is debounced 120 ms, aborted on leave, and a repeat is served from the cache", async () => {
    const t = mk();
    t.store.update((s) => ({ ...s, timeline: { ...emptyTimeline(), hover: 12 } }));
    await vi.advanceTimersByTimeAsync(100);
    expect(t.fetchStep).not.toHaveBeenCalled();
    t.store.update((s) => ({ ...s, timeline: emptyTimeline() }));
    await vi.advanceTimersByTimeAsync(500);
    expect(t.fetchStep).not.toHaveBeenCalled();
    t.store.update((s) => ({ ...s, timeline: { ...emptyTimeline(), hover: 12 } }));
    await vi.advanceTimersByTimeAsync(130);
    expect(t.fetchStep).toHaveBeenCalledTimes(1);
    t.store.update((s) => ({ ...s, timeline: emptyTimeline() }));
    t.store.update((s) => ({ ...s, timeline: { ...emptyTimeline(), highlight: 12 } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.fetchStep).toHaveBeenCalledTimes(1); // cache hit, no second request
    expect(t.store.get().stepRender?.count).toBe(12);
    t.view.dispose();
    vi.useRealTimers();
  });

  it("UI-274 the cache key includes the params revision (display filter) so a filter change refetches", async () => {
    const t = mk();
    t.store.update((s) => ({ ...s, timeline: { ...emptyTimeline(), highlight: 10 } }));
    await vi.advanceTimersByTimeAsync(0);
    t.store.update((s) => ({ ...s, session: sessionFixture({ history: hist(3), revision: { cloud: 3, params: 5 } }) }));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.fetchStep).toHaveBeenCalledTimes(2);
    t.view.dispose();
    vi.useRealTimers();
  });

  it("UI-274 a render for another session is discarded; a replaced session clears the highlight", async () => {
    const t = mk(vi.fn(async (sid: number) => data(sid, "OTHER")));
    t.store.update((s) => ({ ...s, timeline: { ...emptyTimeline(), highlight: 10 } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.store.get().stepRender).toBeNull();
    const ok = mk();
    ok.store.update((s) => ({ ...s, timeline: { ...emptyTimeline(), highlight: 10 } }));
    await vi.advanceTimersByTimeAsync(0);
    ok.store.update((s) => ({ ...s, session: sessionFixture({ session_id: "s2", history: hist(3) }) }));
    expect(ok.store.get().timeline.highlight).toBeNull();
    expect(ok.store.get().stepRender).toBeNull();
    t.view.dispose();
    ok.view.dispose();
    vi.useRealTimers();
  });

  it("UI-275 the highlight is cleared when its step vanishes from the history", async () => {
    const t = mk();
    t.store.update((s) => ({ ...s, timeline: { ...emptyTimeline(), highlight: 12 } }));
    await vi.advanceTimersByTimeAsync(0);
    t.store.update((s) => ({ ...s, session: sessionFixture({ history: hist(2) }) }));
    expect(t.store.get().timeline.highlight).toBeNull();
    t.view.dispose();
    vi.useRealTimers();
  });
});
