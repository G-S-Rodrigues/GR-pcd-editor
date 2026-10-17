import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../files/errors";
import { createAppStore } from "../state/app";
import { candidateFixture, sessionFixture } from "../testing/fixtures";
import { setCenter } from "../tools/box/model";
import { canApply, createRunner } from "./runner";

interface Deferred {
  id: string;
  resolve: (v: Record<string, unknown>) => void;
  reject: (e: unknown) => void;
}

function setup(opts: { op?: "replace" | "add" } = {}) {
  const store = createAppStore();
  store.set({ session: sessionFixture(), tool: "box", op: opts.op ?? "replace" });
  const submitted: unknown[] = [];
  const cancelled: string[] = [];
  const polls: Deferred[] = [];
  let n = 0;
  const api = {
    submitSelection: vi.fn(async (b: unknown) => {
      submitted.push(b);
      return { id: `j${++n}` };
    }),
    submitCandidate: vi.fn(async (_rev: number) => ({ id: `j${++n}` })),
    cancelJob: vi.fn(async (id: string) => {
      cancelled.push(id);
    }),
    poll: vi.fn(
      (id: string) =>
        new Promise<Record<string, unknown>>((resolve, reject) => {
          polls.push({ id, resolve, reject });
        }),
    ),
    refreshState: vi.fn(async () => undefined),
  };
  const runner = createRunner(store, api);
  const editBox = (x: number) => {
    store.update((s) => ({ ...s, tools: { ...s.tools, box: setCenter(s.tools.box, [x, 0, 0]).box } }));
    runner.onToolChanged();
  };
  return { store, api, runner, submitted, cancelled, polls, editBox };
}
const flush = () => vi.advanceTimersByTimeAsync(0);

describe("runner", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("UI-69 five rapid box edits within 250 ms send exactly one selection with the last geometry", async () => {
    const t = setup();
    for (let i = 1; i <= 5; i++) {
      t.editBox(i);
      await vi.advanceTimersByTimeAsync(40);
    }
    expect(t.api.submitSelection).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(t.api.submitSelection).toHaveBeenCalledTimes(1);
    expect((t.submitted[0] as { tool: { center: number[] } }).tool.center).toEqual([5, 0, 0]);
  });

  it("UI-70 a new edit cancels the in-flight job and its late result is ignored", async () => {
    const t = setup();
    t.editBox(1);
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    expect(t.polls).toHaveLength(1);
    t.editBox(2);
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    expect(t.cancelled).toContain("j1");
    expect(t.polls).toHaveLength(2);
    // the OLD job resolves late: ignored
    t.polls[0].resolve({ selected: 1, operand: 1, candidate: candidateFixture({ candidate_id: "old" }) });
    await flush();
    expect(t.store.get().candidate).toBeNull();
    t.polls[1].resolve({ selected: 2, operand: 2, candidate: candidateFixture({ candidate_id: "new" }) });
    await flush();
    expect(t.store.get().candidate?.candidate_id).toBe("new");
    expect(t.store.get().job.busy).toBe(false);
  });

  it("UI-71 a stale job is not an error; it is retried once with fresh revisions", async () => {
    const t = setup();
    t.editBox(1);
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    t.polls[0].reject(new ApiError(409, "stale", "the job ended as stale"));
    await flush();
    expect(t.store.get().notices).toHaveLength(0);
    expect(t.api.refreshState).toHaveBeenCalled();
    expect(t.api.submitSelection).toHaveBeenCalledTimes(2); // retried once
    await flush();
    t.polls[1].reject(new ApiError(409, "stale", "the job ended as stale"));
    await flush();
    expect(t.api.submitSelection).toHaveBeenCalledTimes(2); // not retried twice
    expect(t.store.get().notices).toHaveLength(0);
    expect(t.store.get().candidate).toBeNull();
    expect(t.store.get().job.busy).toBe(false);
  });

  it("UI-72 AC-11: a candidate for params N cannot be applied after the params moved to N+1", async () => {
    const t = setup();
    t.editBox(1);
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    // the filter changes while the preview computes
    t.store.set({ session: sessionFixture({ revision: { cloud: 3, params: 5 } }) });
    t.runner.paramsChanged();
    expect(canApply(t.store.get())).toBe(false);
    t.polls[0].resolve({ selected: 3, operand: 3, candidate: candidateFixture({ params_revision: 4 }) });
    await flush();
    expect(t.store.get().candidate).toBeNull();
    expect(canApply(t.store.get())).toBe(false);
    // even a stale candidate placed in the store is not appliable
    t.store.set({ candidate: candidateFixture({ params_revision: 4 }) });
    expect(canApply(t.store.get())).toBe(false);
    t.store.set({ candidate: candidateFixture({ params_revision: 5 }) });
    expect(canApply(t.store.get())).toBe(true);
    // not while a job is running or a draft is pending or protection needs an acknowledgement
    t.store.set({ job: { busy: true, progress: null, message: null } });
    expect(canApply(t.store.get())).toBe(false);
    t.store.set({ job: { busy: false, progress: null, message: null }, draft: true });
    expect(canApply(t.store.get())).toBe(false);
  });

  it("UI-72 a candidate-only refresh runs after params change when a selection exists", async () => {
    const t = setup();
    t.store.set({ session: sessionFixture({ selection: { count: 5, ops: [] } }) });
    t.runner.paramsChanged();
    await vi.advanceTimersByTimeAsync(300);
    await flush();
    expect(t.api.submitCandidate).toHaveBeenCalledWith(3);
    t.polls[0].resolve(candidateFixture({ params_revision: 4 }) as unknown as Record<string, unknown>);
    await flush();
    expect(t.store.get().candidate?.candidate_id).toBe("c1");
  });

  it("UI-74 numeric edit and gizmo drag use the same entry point (progress mirrored)", async () => {
    const t = setup();
    t.api.poll.mockImplementationOnce(
      (id: string, o?: { onProgress?: (p: number | null, m: string | null) => void }) =>
        new Promise<Record<string, unknown>>((resolve, reject) => {
          o?.onProgress?.(0.5, "evaluating");
          t.polls.push({ id, resolve, reject });
        }),
    );
    t.editBox(3); // either source calls onToolChanged
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    expect(t.store.get().job).toEqual({ busy: true, progress: 0.5, message: "evaluating" });
  });

  it("UI-68 in Add mode a tool edit is a draft: no request until commit", async () => {
    const t = setup({ op: "add" });
    t.editBox(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.api.submitSelection).not.toHaveBeenCalled();
    expect(t.store.get().draft).toBe(true);
    expect(canApply(t.store.get())).toBe(false);
    t.runner.commitDraft();
    await flush();
    expect(t.api.submitSelection).toHaveBeenCalledTimes(1);
    expect((t.submitted[0] as { op: string }).op).toBe("add");
    expect(t.store.get().draft).toBe(false);
  });

  it("one-shot requests (select displayed, invert) run immediately without a tool and supersede earlier jobs", async () => {
    const t = setup();
    t.runner.oneShot((rev) => ({
      cloud_revision: rev,
      op: "invert",
      scope: "active",
      tool: null,
      evaluate_candidate: true,
    }));
    await flush();
    expect(t.submitted[0]).toEqual({ cloud_revision: 3, op: "invert", scope: "active", tool: null, evaluate_candidate: true });
    t.runner.oneShot((rev) => ({ cloud_revision: rev, op: "replace", scope: "displayed", tool: { type: "filter" }, evaluate_candidate: true }));
    await flush();
    expect(t.cancelled).toContain("j1");
    t.polls[1].resolve({ selected: 9, operand: 9, candidate: candidateFixture({ candidate_id: "one" }) });
    await flush();
    expect(t.store.get().candidate?.candidate_id).toBe("one");
  });
});

describe("runner invalidation (F-01/F-02)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const withSelection = (t: ReturnType<typeof setup>, count = 127) =>
    t.store.set({ session: sessionFixture({ selection: { count, ops: [] } }), candidate: candidateFixture({ candidates: count }) });

  it("UI-100 a filter change with a live box clears the candidate and re-selects; the stale count never applies", async () => {
    const t = setup();
    withSelection(t);
    t.runner.paramsChanged("filter");
    expect(t.store.get().candidate).toBeNull();
    expect(canApply(t.store.get())).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    await flush();
    expect(t.api.submitSelection).toHaveBeenCalledTimes(1); // the selection, not only /candidate
    expect(t.api.submitCandidate).not.toHaveBeenCalled();
    expect(canApply(t.store.get())).toBe(false);
    t.polls[0].resolve({ selected: 27, operand: 27, candidate: candidateFixture({ candidates: 27 }) });
    await flush();
    expect(t.store.get().candidate?.candidates).toBe(27);
    expect(canApply(t.store.get())).toBe(true);
  });

  it("UI-101 a protection change with a live box still uses the candidate endpoint only; a scope change re-selects", async () => {
    const t = setup();
    withSelection(t, 5);
    t.runner.paramsChanged("protection");
    await vi.advanceTimersByTimeAsync(300);
    await flush();
    expect(t.api.submitCandidate).toHaveBeenCalledTimes(1);
    expect(t.api.submitSelection).not.toHaveBeenCalled();
    t.runner.paramsChanged("scope");
    expect(t.store.get().candidate).toBeNull();
    await vi.advanceTimersByTimeAsync(300);
    await flush();
    expect(t.api.submitSelection).toHaveBeenCalledTimes(1);
  });

  it("UI-102 a filter change with no live tool: the backend refuses the frozen selection; Apply stays off and the user is told", async () => {
    const t = setup();
    t.store.set({ tool: "none" });
    withSelection(t, 127);
    t.runner.paramsChanged("filter");
    expect(canApply(t.store.get())).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    await flush();
    expect(t.api.submitSelection).not.toHaveBeenCalled();
    t.polls[0].reject(new ApiError(422, "selection_outdated", "backend text"));
    await flush();
    expect(t.store.get().candidate).toBeNull();
    expect(canApply(t.store.get())).toBe(false);
    expect(t.store.get().notices.map((n) => n.text).join(" ")).toMatch(/select again/i);
  });
});
