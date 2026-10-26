import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../files/errors";
import { createAppStore } from "../state/app";
import { candidateFixture, sessionFixture } from "../testing/fixtures";
import { setCenter } from "../tools/box/model";
import { setSeed } from "../tools/cluster/model";
import { applyBlockedText, canApply, createRunner, deleteBlockedNote, deleteKeyOutcome } from "./runner";
import { shouldPreview } from "./selection";
import { statusItems } from "../status/model";

interface Deferred {
  id: string;
  resolve: (v: Record<string, unknown>) => void;
  reject: (e: unknown) => void;
}

function setup(opts: { op?: "add" | "subtract" | "intersect"; count?: number; liveFirst?: boolean } = {}) {
  const store = createAppStore();
  store.set({
    session: sessionFixture(opts.count ? { selection: { count: opts.count, ops: [] } } : {}),
    tool: "box",
    op: opts.op ?? "add",
    liveFirst: opts.liveFirst ?? opts.op === undefined, // no op named: the first (live) selection
  });
  const submitted: unknown[] = [];
  const previews: unknown[] = [];
  const commits: unknown[] = [];
  const cancelled: string[] = [];
  const polls: Deferred[] = [];
  let n = 0;
  const api = {
    submitSelection: vi.fn(async (b: unknown) => {
      submitted.push(b);
      return { id: `j${++n}` };
    }),
    submitCandidate: vi.fn(async (_rev: number) => ({ id: `j${++n}` })),
    submitPreview: vi.fn(async (b: unknown) => {
      previews.push(b);
      return { id: `j${++n}` };
    }),
    submitCommit: vi.fn(async (b: unknown) => {
      commits.push(b);
      return { id: `j${++n}` };
    }),
    discardPreview: vi.fn(async (_rev: number) => undefined),
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
    beaconCancel: vi.fn((_id: string) => undefined),
  };
  const runner = createRunner(store, api);
  const editBox = (x: number) => {
    store.update((s) => ({ ...s, tools: { ...s.tools, box: setCenter(s.tools.box, [x, 0, 0]).box } }));
    runner.onToolChanged();
  };
  return { store, api, runner, submitted, previews, commits, cancelled, polls, editBox };
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
    // not while a job is running or protection needs an acknowledgement (a draft does not block it)
    t.store.set({ job: { busy: true, progress: null, message: null } });
    expect(canApply(t.store.get())).toBe(false);
    // a pending draft no longer blocks Apply (owner ruling A): Apply deletes the committed selection only
    t.store.set({ job: { busy: false, progress: null, message: null }, draft: true });
    expect(canApply(t.store.get())).toBe(true);
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

  it("UI-68 in Add mode a tool edit is a draft: no selection request until commit (it previews instead, UI-405)", async () => {
    const t = setup({ op: "add", count: 10 });
    t.editBox(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.api.submitSelection).not.toHaveBeenCalled();
    expect(t.store.get().draft).toBe(true);
    t.polls[0].resolve({ preview_id: "p1", selected_after: 12, base_selected: 10, added: 2, removed: 0, operand: 2 });
    await flush();
    t.runner.commitDraft();
    await flush();
    expect(t.api.submitSelection).not.toHaveBeenCalled();
    expect(t.commits).toHaveLength(1);
    t.polls[1].resolve({ selected: 12, candidate: candidateFixture() });
    await flush();
    expect(t.store.get().draft).toBe(false);
  });

  it("UI-290 Preview with a pending Add draft keeps the draft and previews nothing: it must not turn the old selection into an appliable candidate", async () => {
    const t = setup({ op: "add" });
    t.store.set({ session: sessionFixture({ selection: { count: 40, ops: [] } }) });
    t.editBox(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.store.get().draft).toBe(true);
    t.runner.previewNow();
    await flush();
    expect(t.api.submitCandidate).not.toHaveBeenCalled();
    expect(t.api.submitSelection).not.toHaveBeenCalled();
    expect(t.store.get().draft).toBe(true);
    expect(t.store.get().candidate).toBeNull();
    expect(t.store.get().notices.map((n) => n.code)).toContain("draft_pending");
  });

  it("UI-291 the Apply tooltip never blames Max points (a partial cluster can be applied), and a pending draft has no case", () => {
    const base = createAppStore().get();
    const partial = candidateFixture({ candidates: 5, cluster: { seed_id: 1, radius: 0.5, size: 5, complete: false, limit: 5, bounds: { min: [0, 0, 0], max: [1, 1, 1] } } });
    expect(applyBlockedText({ ...base, session: sessionFixture(), candidate: partial })).not.toMatch(/Max points/);
    // a draft no longer disables Apply, so the tooltip has no draft case (ruling A)
    expect(applyBlockedText({ ...base, session: sessionFixture(), draft: true })).toBe("preview a selection first");
    expect(applyBlockedText({ ...base, session: sessionFixture() })).toBe("preview a selection first");
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

  it("UI-812 a layer change with a live box re-selects like a filter change; the stale candidate never applies", async () => {
    const t = setup();
    withSelection(t);
    t.runner.paramsChanged("layers");
    expect(t.store.get().candidate).toBeNull();
    expect(canApply(t.store.get())).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    await flush();
    expect(t.api.submitSelection).toHaveBeenCalledTimes(1);
    expect(t.api.submitCandidate).not.toHaveBeenCalled();
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

describe("cluster reacts to parameter changes and partial results (F-04, F-07)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("UI-110 with a seed picked, a protection change re-runs the cluster selection instead of only the candidate", async () => {
    const t = setup();
    t.store.update((s) => ({ ...s, tool: "cluster", tools: { ...s.tools, cluster: setSeed(s.tools.cluster, { id: 7, point: [0, 0, 0] }) } }));
    t.store.set({ session: sessionFixture({ selection: { count: 300, ops: [] } }), candidate: candidateFixture({ candidates: 300 }) });
    t.runner.paramsChanged("protection");
    expect(t.store.get().candidate).toBeNull();
    await vi.advanceTimersByTimeAsync(300);
    await flush();
    expect(t.api.submitSelection).toHaveBeenCalledTimes(1);
    expect((t.submitted[0] as { tool: { type: string; seed_id: number } }).tool).toMatchObject({ type: "cluster", seed_id: 7 });
    expect(t.api.submitCandidate).not.toHaveBeenCalled();
  });

  it("UI-109 a partial cluster (exactly Max points, labelled) can be applied", () => {
    const t = setup();
    const cluster = (complete: boolean) => ({ seed_id: 1, radius: 0.5, size: 41, complete, limit: complete ? null : 40, bounds: { min: [0, 0, 0], max: [1, 1, 1] } });
    t.store.set({ candidate: candidateFixture({ cluster: cluster(true) }) });
    expect(canApply(t.store.get())).toBe(true);
    t.store.set({ candidate: candidateFixture({ cluster: cluster(false) }) });
    expect(canApply(t.store.get())).toBe(true);
  });

  it("UI-870 the Delete key runs Apply for a current partial cluster candidate", () => {
    const t = setup();
    const partial = { seed_id: 1, radius: 0.5, size: 40, complete: false, limit: 40, bounds: { min: [0, 0, 0], max: [1, 1, 1] } };
    t.store.set({ candidate: candidateFixture({ cluster: partial }) });
    expect(deleteKeyOutcome(t.store.get())).toEqual({ run: true });
  });

  it("UI-875 deleteBlockedNote says why Delete is off, and stays null when Delete works or the reason is transient or nothing is selected", () => {
    const base = createAppStore().get();
    const sess = (count: number) => sessionFixture({ selection: { count, ops: [] } });
    const ok = { ...base, session: sess(50), candidate: candidateFixture() };
    expect(deleteBlockedNote(ok)).toBeNull(); // Delete works
    expect(deleteBlockedNote(base)).toBeNull(); // no session
    expect(deleteBlockedNote({ ...base, session: sess(0) })).toBeNull(); // nothing selected, no candidate
    expect(deleteBlockedNote({ ...ok, job: { busy: true, progress: null, message: null } })).toBeNull(); // the progress bar says it
    const prot = (p: Partial<typeof base.tools.protection>) => ({ ...ok, tools: { ...ok.tools, protection: { ...ok.tools.protection, ...p } } });
    expect(deleteBlockedNote(prot({ mode: "override", ack: false }))).toBe(`Delete is off: ${applyBlockedText(prot({ mode: "override", ack: false }))}`);
    expect(deleteBlockedNote(prot({ mode: "override", ack: false }))).toMatch(/^Delete is off: .+/);
    expect(deleteBlockedNote(prot({ mode: "add_local", local: null }))).toMatch(/^Delete is off: .+/);
    expect(deleteBlockedNote(prot({ mode: "override", ack: true, local: { min: 0, max: 1 } }))).toBeNull();
    expect(deleteBlockedNote({ ...ok, compare: "original" })).toBe("Delete is off: return to the edited view");
    expect(deleteBlockedNote({ ...ok, candidate: candidateFixture({ cloud_revision: 2 }) })).toBe("Delete is off: the preview is out of date or empty; preview again");
  });

  it("UI-151 pagehide beacons a cancel for the in-flight job only", async () => {
    const t = setup();
    t.runner.onPageHide();
    expect(t.api.beaconCancel).not.toHaveBeenCalled();
    t.editBox(1);
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    expect(t.polls).toHaveLength(1);
    t.runner.onPageHide();
    expect(t.api.beaconCancel).toHaveBeenCalledWith(t.polls[0].id);
    t.polls[0].resolve({ candidate: null });
    await flush();
    t.runner.onPageHide();
    expect(t.api.beaconCancel).toHaveBeenCalledTimes(1);
  });

  const landing = (id = "p1", after = 12) => ({ preview_id: id, selected_after: after, base_selected: 10, added: after - 10, removed: 0, operand: 2 });

  it("UI-405 a tool edit in Add sends one preview after the debounce, never a selection, keeps the candidate and sets preview not candidate", async () => {
    const t = setup({ op: "add", count: 10 });
    t.store.set({ candidate: candidateFixture({ params_revision: 4 }) });
    for (let i = 1; i <= 5; i++) {
      t.editBox(i);
      await vi.advanceTimersByTimeAsync(40);
    }
    expect(t.api.submitPreview).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    expect(t.api.submitPreview).toHaveBeenCalledTimes(1);
    const b = t.previews[0] as { op: string; tool: { center: number[] }; evaluate_candidate?: unknown };
    expect(b.op).toBe("add");
    expect(b.tool.center).toEqual([5, 0, 0]);
    expect("evaluate_candidate" in b).toBe(false);
    expect(t.api.submitSelection).not.toHaveBeenCalled();
    expect(t.store.get().candidate?.candidate_id).toBe("c1");
    expect(t.store.get().draft).toBe(true);
    t.polls[0].resolve(landing());
    await flush();
    expect(t.store.get().preview).toMatchObject({ id: "p1", op: "add", selected_after: 12, added: 2 });
    expect(t.store.get().candidate?.candidate_id).toBe("c1");
    expect(t.store.get().job.busy).toBe(false);
  });

  it("UI-406 a second edit supersedes the first preview: cancel posted, the stale result dropped, cancelled is silent", async () => {
    const t = setup({ op: "subtract", count: 10 });
    t.editBox(1);
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    t.editBox(2);
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    expect(t.cancelled).toContain("j1");
    t.polls[0].resolve(landing("old"));
    await flush();
    expect(t.store.get().preview).toBeNull();
    t.polls[0].reject(new ApiError(409, "cancelled", "x"));
    t.polls[1].resolve(landing("new"));
    await flush();
    expect(t.store.get().preview?.id).toBe("new");
    expect(t.store.get().notices).toHaveLength(0);
  });

  it("UI-407 commitDraft sends commit with the current preview id once and no preview request; success clears draft and preview and sets the candidate", async () => {
    const t = setup({ op: "add", count: 10 });
    t.editBox(1);
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    t.polls[0].resolve(landing("p7"));
    await flush();
    t.api.submitPreview.mockClear();
    t.runner.commitDraft();
    await flush();
    expect(t.api.submitPreview).not.toHaveBeenCalled();
    expect(t.api.submitSelection).not.toHaveBeenCalled();
    expect(t.commits).toEqual([{ cloud_revision: 3, preview_id: "p7" }]);
    t.polls[1].resolve({ selected: 12, candidate: candidateFixture() });
    await flush();
    const s = t.store.get();
    expect(s.draft).toBe(false);
    expect(s.preview).toBeNull();
    expect(s.candidate?.candidate_id).toBe("c1");
  });

  it("UI-407 a commit with no preview ready previews first and commits that preview, never blindly", async () => {
    const t = setup({ op: "add", count: 10 });
    t.editBox(1);
    t.runner.commitDraft(); // debounce still pending, no preview yet
    await flush();
    expect(t.api.submitPreview).toHaveBeenCalledTimes(1);
    expect(t.api.submitCommit).not.toHaveBeenCalled();
    t.polls[0].resolve(landing("pz"));
    await flush();
    expect(t.commits).toEqual([{ cloud_revision: 3, preview_id: "pz" }]);
  });

  it("UI-407 a commit answered 409 stale_revision refreshes, previews once more and says so", async () => {
    const t = setup({ op: "add", count: 10 });
    t.editBox(1);
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    t.polls[0].resolve(landing("p1"));
    await flush();
    t.runner.commitDraft();
    await flush();
    t.polls[1].reject(new ApiError(409, "stale_revision", "the preview is obsolete"));
    await flush();
    expect(t.api.submitPreview).toHaveBeenCalledTimes(2);
    expect(t.store.get().notices.map((n) => n.code)).toContain("preview_refreshed");
  });

  it("UI-408 discard drops preview and draft, posts discard, leaves selection and candidate; reset and clear do the same", async () => {
    const t = setup({ op: "add", count: 10 });
    t.store.set({ candidate: candidateFixture({ params_revision: 4 }) });
    t.editBox(1);
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    t.polls[0].resolve(landing());
    await flush();
    t.runner.discardDraft();
    await flush();
    const s = t.store.get();
    expect(s.preview).toBeNull();
    expect(s.draft).toBe(false);
    expect(s.candidate?.candidate_id).toBe("c1");
    expect(s.session?.selection.count).toBe(10);
    expect(t.api.discardPreview).toHaveBeenCalledWith(3);
    // a preview still computing is cancelled and its late result dropped
    t.editBox(2);
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    t.runner.discardDraft();
    t.polls[1].resolve(landing("late"));
    await flush();
    expect(t.cancelled).toContain("j2");
    expect(t.store.get().preview).toBeNull();
    // reset
    t.store.set({ preview: { id: "x", op: "add", selected_after: 1, base_selected: 0, added: 1, removed: 0 }, draft: true });
    t.runner.reset();
    expect(t.store.get().preview).toBeNull();
    expect(t.store.get().draft).toBe(false);
  });

  it("UI-409 a first (live) selection: a tool edit sends a replace selection after the debounce and never a preview", async () => {
    const t = setup({ op: "add", count: 10, liveFirst: true });
    t.editBox(1);
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    expect(t.api.submitPreview).not.toHaveBeenCalled();
    expect((t.submitted[0] as { op: string }).op).toBe("replace");
  });

  it("UI-411 Apply stays enabled while a draft or preview is pending when a current committed candidate exists, but not while a job runs", () => {
    const t = setup({ op: "add", count: 10 });
    t.store.set({
      candidate: candidateFixture({ params_revision: 4 }),
      session: sessionFixture({ selection: { count: 10, ops: [] } }),
      draft: true,
      preview: { id: "p", op: "add", selected_after: 12, base_selected: 10, added: 2, removed: 0 },
    });
    expect(canApply(t.store.get())).toBe(true);
    t.store.set({ job: { busy: true, progress: null, message: null } });
    expect(canApply(t.store.get())).toBe(false);
  });

  it("UI-415 shouldPreview: Add/Subtract/Intersect preview only over a non-empty selection; the first selection goes live (owner ruling D)", async () => {
    expect(shouldPreview({ ...createAppStore().get(), op: "add", session: sessionFixture() })).toBe(false);
    expect(shouldPreview({ ...createAppStore().get(), op: "add", session: sessionFixture({ selection: { count: 3, ops: [] } }) })).toBe(true);
    expect(shouldPreview({ ...createAppStore().get(), op: "add", liveFirst: true, session: sessionFixture({ selection: { count: 3, ops: [] } }) })).toBe(false);
    const t = setup({ op: "add" }); // empty selection
    t.editBox(1);
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    expect(t.api.submitPreview).not.toHaveBeenCalled();
    expect(t.submitted).toHaveLength(1);
    expect((t.submitted[0] as { op: string }).op).toBe("add");
    expect(t.store.get().draft).toBe(false);
  });

  it("UI-624 Live preview off: a shape edit over a selection sends no preview, keeps the draft, and drops an older preview", async () => {
    const t = setup({ op: "add", count: 10 });
    t.store.set({ previewLive: false });
    t.store.set({ preview: { id: "old", op: "add", selected_after: 12, base_selected: 10, added: 2, removed: 0 } });
    t.editBox(1);
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    expect(t.api.submitPreview).not.toHaveBeenCalled();
    expect(t.api.submitSelection).not.toHaveBeenCalled();
    expect(t.store.get().draft).toBe(true);
    expect(t.store.get().preview).toBeNull();
    expect(t.api.discardPreview).toHaveBeenCalledTimes(1);
  });

  it("UI-625 Live preview off: Commit draft previews first and commits that preview when it lands", async () => {
    const t = setup({ op: "add", count: 10 });
    t.store.set({ previewLive: false });
    t.editBox(1);
    await vi.advanceTimersByTimeAsync(250);
    t.runner.commitDraft();
    await flush();
    expect(t.api.submitPreview).toHaveBeenCalledTimes(1);
    expect(t.api.submitCommit).not.toHaveBeenCalled();
    t.polls[0].resolve({ preview_id: "p9", selected_after: 12, base_selected: 10, added: 2, removed: 0 });
    await flush();
    await flush();
    expect(t.commits).toEqual([{ cloud_revision: 3, preview_id: "p9" }]);
  });

  it("UI-412 each cluster parameter edit in Add sends one debounced preview carrying it; five rapid radius edits send one and cancel the earlier jobs", async () => {
    const t = setup({ op: "add", count: 10 });
    t.store.update((s) => ({ ...s, tool: "cluster", tools: { ...s.tools, cluster: setSeed(s.tools.cluster, { id: 5, point: [0, 0, 0] }) } }));
    const radius = (r: number) => {
      t.store.update((s) => ({ ...s, tools: { ...s.tools, cluster: { ...s.tools.cluster, radius: r } } }));
      t.runner.onToolChanged();
    };
    radius(0.3);
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    for (const r of [0.4, 0.5, 0.6, 0.7, 0.8]) {
      radius(r);
      await vi.advanceTimersByTimeAsync(40);
    }
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    expect(t.api.submitPreview).toHaveBeenCalledTimes(2);
    expect((t.previews[1] as { tool: { type: string; radius: number } }).tool).toMatchObject({ type: "cluster", radius: 0.8 });
    expect(t.cancelled).toContain("j1");
    expect(t.api.submitSelection).not.toHaveBeenCalled();
    t.store.update((s) => ({ ...s, tools: { ...s.tools, cluster: { ...s.tools.cluster, excludeProtected: !s.tools.cluster.excludeProtected } } }));
    t.runner.onToolChanged();
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    expect(t.api.submitPreview).toHaveBeenCalledTimes(3);
  });

  it("UI-414 a commit pressed while a newer edit's preview still computes is not sent; after it lands the commit carries that preview's id", async () => {
    const t = setup({ op: "add", count: 10 });
    t.editBox(1);
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    t.polls[0].resolve(landing("old"));
    await flush();
    t.editBox(2);
    await vi.advanceTimersByTimeAsync(250);
    await flush(); // second preview running
    t.runner.commitDraft();
    await flush();
    expect(t.api.submitCommit).not.toHaveBeenCalled();
    t.polls[1].resolve(landing("new"));
    await flush();
    expect(t.commits).toEqual([{ cloud_revision: 3, preview_id: "new" }]);
  });

  it("UI-653 an edit that supersedes a live selection between its state refresh and its candidate does not lose the candidate: Apply is enabled once idle", async () => {
    const t = setup({ count: 10 }); // the first (live) selection
    let release: () => void = () => undefined;
    t.api.refreshState.mockImplementationOnce(() => new Promise<undefined>((r) => (release = () => r(undefined))));
    t.editBox(1);
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    t.polls[0].resolve({ selected: 10, operand: 10, candidate: candidateFixture() });
    await flush(); // the selection is installed; the state refresh is in flight
    t.store.set({ liveFirst: false, op: "add" }); // the user picks Add, then edits the shape: a draft
    t.editBox(2);
    release();
    await flush();
    expect(t.store.get().candidate?.candidate_id).toBe("c1");
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    t.polls[1].resolve(landing());
    await flush();
    expect(t.store.get().job.busy).toBe(false);
    expect(t.store.get().preview).toMatchObject({ id: "p1" });
    expect(t.store.get().candidate?.candidate_id).toBe("c1");
    expect(canApply(t.store.get())).toBe(true);
  });

  it("UI-654 a candidate is not adopted from a superseded selection when the edit invalidated it (live re-select, filter change)", async () => {
    const t = setup({ count: 10 });
    let release: () => void = () => undefined;
    t.api.refreshState.mockImplementationOnce(() => new Promise<undefined>((r) => (release = () => r(undefined))));
    t.editBox(1);
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    t.polls[0].resolve({ selected: 10, operand: 10, candidate: candidateFixture({ candidate_id: "old" }) });
    await flush();
    t.editBox(2); // still the live first selection: a new selection follows
    release();
    await flush();
    expect(t.store.get().candidate).toBeNull();
    t.api.refreshState.mockImplementationOnce(() => new Promise<undefined>((r) => (release = () => r(undefined))));
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    t.polls[1].resolve({ selected: 10, operand: 10, candidate: candidateFixture({ candidate_id: "old2" }) });
    await flush();
    t.runner.paramsChanged("filter");
    release();
    await flush();
    expect(t.store.get().candidate).toBeNull();
  });

  const committed = () => ({
    candidate: candidateFixture({ params_revision: 4 }),
    session: sessionFixture({ selection: { count: 10, ops: [] } }),
  });

  it("UI-700 canApply is true with a current candidate while a preview job runs, false while any other job runs", () => {
    const t = setup({ op: "add", count: 10 });
    t.store.set({ ...committed(), draft: true, job: { busy: true, preview: true, progress: null, message: null } });
    expect(canApply(t.store.get())).toBe(true);
    t.store.set({ job: { busy: true, progress: null, message: null } });
    expect(canApply(t.store.get())).toBe(false);
    expect(applyBlockedText(t.store.get())).toBe("a job is running");
  });

  it("UI-701 a preview job is flagged: Apply stays enabled while its poll is pending and the job is idle when it lands", async () => {
    const t = setup({ op: "add", count: 10 });
    t.store.set({ ...committed() });
    t.editBox(1);
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    expect(t.polls).toHaveLength(1);
    expect(t.store.get().job.busy).toBe(true);
    expect(t.store.get().job.preview).toBe(true);
    expect(canApply(t.store.get())).toBe(true);
    t.polls[0].resolve(landing());
    await flush();
    expect(t.store.get().job).toEqual({ busy: false, progress: null, message: null });
    expect(canApply(t.store.get())).toBe(true);
  });

  it("UI-701 supersedePreview cancels a running preview and a pending debounce and leaves the job idle", async () => {
    const t = setup({ op: "add", count: 10 });
    t.store.set({ ...committed() });
    t.editBox(1);
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    t.runner.supersedePreview();
    expect(t.cancelled).toEqual(["j1"]);
    expect(t.store.get().job.busy).toBe(false);
    t.editBox(2); // debounce pending, nothing running
    t.runner.supersedePreview();
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    expect(t.api.submitPreview).toHaveBeenCalledTimes(1);
  });

  it("UI-703 a box edit while a commit is in flight does not cancel it; the preview of the new shape waits for it and the candidate is kept", async () => {
    const t = setup({ op: "add", count: 10 });
    t.editBox(1);
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    t.polls[0].resolve(landing("p7"));
    await flush();
    t.runner.commitDraft();
    await flush();
    expect(t.commits).toHaveLength(1);
    t.editBox(2); // the user keeps editing while the commit runs
    await vi.advanceTimersByTimeAsync(500);
    await flush();
    expect(t.cancelled).toEqual([]);
    expect(t.api.submitPreview).toHaveBeenCalledTimes(1); // no new preview yet
    expect(t.store.get().job.busy).toBe(true);
    t.polls[1].resolve({ selected: 12, candidate: candidateFixture() });
    await flush();
    expect(t.store.get().candidate?.candidate_id).toBe("c1");
    expect(t.api.submitPreview).toHaveBeenCalledTimes(2);
    expect((t.previews[1] as { tool: { center: number[] } }).tool.center).toEqual([2, 0, 0]);
    expect(t.store.get().draft).toBe(true);
    t.polls[2].resolve(landing("p8"));
    await flush();
    expect(t.store.get().preview).toMatchObject({ id: "p8" });
    expect(t.store.get().candidate?.candidate_id).toBe("c1");
    expect(canApply(t.store.get())).toBe(true);
    t.editBox(3); // the commit has settled: an edit now previews on its own after the debounce
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    expect(t.api.submitPreview).toHaveBeenCalledTimes(3);
  });

  it("UI-704 a commit that ends cancelled over a non-empty selection triggers one candidate evaluation, after which Apply is enabled", async () => {
    const t = setup({ op: "add", count: 10 });
    t.editBox(1);
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    t.polls[0].resolve(landing("p7"));
    await flush();
    t.runner.commitDraft();
    await flush();
    t.polls[1].reject(new ApiError(200, "cancelled", "cancelled"));
    await flush();
    expect(t.api.submitCandidate).toHaveBeenCalledTimes(1);
    t.polls[2].resolve({ candidate: candidateFixture({ params_revision: 4 }) });
    await flush();
    expect(t.store.get().job.busy).toBe(false);
    expect(canApply(t.store.get())).toBe(true);
  });

  it("UI-705 the Delete key is refused with a notice text when Apply is blocked and runs when it is not", () => {
    const t = setup({ op: "add", count: 10 });
    expect(deleteKeyOutcome(t.store.get())).toEqual({ run: false, notice: "preview a selection first" });
    t.store.set({ ...committed() });
    expect(deleteKeyOutcome(t.store.get())).toEqual({ run: true });
    t.store.set({ job: { busy: true, progress: null, message: null } });
    expect(deleteKeyOutcome(t.store.get())).toEqual({ run: false, notice: "a job is running" });
    t.store.set({ job: { busy: true, preview: true, progress: null, message: null } });
    expect(deleteKeyOutcome(t.store.get())).toEqual({ run: true });
  });
});

describe("runner re-arm after Commit draft (R17-2)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const landing = (id = "p1") => ({ preview_id: id, selected_after: 12, base_selected: 10, added: 2, removed: 0, operand: 2 });

  async function draftCluster() {
    const t = setup({ op: "add", count: 10 });
    t.store.update((s) => ({
      ...s,
      tool: "cluster",
      interaction: "orbit",
      tools: { ...s.tools, cluster: { ...setSeed(s.tools.cluster, { id: 7, point: [0, 0, 0] }), radius: 0.7, maxPoints: 123 } },
    }));
    t.runner.onToolChanged();
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    t.polls[0].resolve(landing("p7"));
    await flush();
    return t;
  }

  it("UI-878 after a successful cluster commit the seed is cleared, Pick point waits, other parameters stay and no job starts", async () => {
    const t = await draftCluster();
    t.runner.commitDraft();
    await flush();
    const before = t.api.submitPreview.mock.calls.length + t.api.submitSelection.mock.calls.length;
    t.polls[1].resolve({ selected: 12, candidate: candidateFixture() });
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    const s = t.store.get();
    expect(s.tool).toBe("cluster");
    expect(s.tools.cluster.seed).toBeNull();
    expect(s.interaction).toBe("pick-seed");
    expect(s.tools.cluster).toMatchObject({ radius: 0.7, maxPoints: 123 });
    expect(s.draft).toBe(false);
    expect(t.api.submitPreview.mock.calls.length + t.api.submitSelection.mock.calls.length).toBe(before);
  });

  it("UI-879 (regression guard, green at HEAD) after a box commit the tool and the box are unchanged", async () => {
    const t = setup({ op: "add", count: 10 });
    t.editBox(1);
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    t.polls[0].resolve(landing("p7"));
    await flush();
    const box = t.store.get().tools.box;
    t.runner.commitDraft();
    await flush();
    t.polls[1].resolve({ selected: 12, candidate: candidateFixture() });
    await flush();
    expect(t.store.get().tool).toBe("box");
    expect(t.store.get().tools.box).toEqual(box);
    expect(t.store.get().interaction).not.toBe("pick-seed");
  });

  it("UI-880 a seed picked while the commit is in flight is kept and its preview runs when the commit settles", async () => {
    const t = await draftCluster();
    t.runner.commitDraft();
    await flush();
    t.store.update((s) => ({ ...s, interaction: "orbit", tools: { ...s.tools, cluster: setSeed(s.tools.cluster, { id: 99, point: [1, 1, 1] }) } }));
    t.runner.onToolChanged();
    t.polls[1].resolve({ selected: 12, candidate: candidateFixture() });
    await flush();
    expect(t.store.get().tools.cluster.seed).toMatchObject({ id: 99 });
    expect(t.store.get().interaction).toBe("orbit");
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    expect(t.api.submitPreview).toHaveBeenCalledTimes(2);
    expect((t.previews[1] as { tool: { seed_id: number } }).tool.seed_id).toBe(99);
  });

  it("UI-881 a commit that fails or is cancelled keeps the seed", async () => {
    for (const code of ["stale_revision", "cancelled", "boom"]) {
      const t = await draftCluster();
      t.runner.commitDraft();
      await flush();
      t.polls[1].reject(new ApiError(code === "boom" ? 500 : 409, code, "x"));
      await flush();
      await vi.advanceTimersByTimeAsync(300);
      expect(t.store.get().tools.cluster.seed).toMatchObject({ id: 7 });
    }
  });
});

describe("runner one-shot landing (R17-8)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const body = (rev: number) => ({ cloud_revision: rev, op: "add" as const, scope: "active" as const, tool: { type: "layer" as const, layer_id: 1 }, evaluate_candidate: true });

  it("UI-884 a params-hook reselect pending when a one-shot starts is dropped: exactly one selection request, and the one-shot resolves true when it lands", async () => {
    const t = setup({ op: "add", count: 10 });
    t.store.set({ liveFirst: true });
    t.runner.paramsChanged("layers");
    const landed = t.runner.oneShot(body);
    await flush();
    expect(t.polls).toHaveLength(1);
    t.polls[0].resolve({ selected: 12, operand: 2, candidate: candidateFixture() });
    await expect(landed).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.api.submitSelection).toHaveBeenCalledTimes(1);
    expect(t.api.submitCandidate).not.toHaveBeenCalled();
  });

  it("UI-884 a one-shot superseded by a user action resolves false, and so does one that fails", async () => {
    const t = setup({ op: "add", count: 10 });
    const first = t.runner.oneShot(body);
    await flush();
    t.runner.oneShot(body);
    await flush();
    t.polls[0].resolve({ selected: 12, operand: 2, candidate: candidateFixture() });
    await expect(first).resolves.toBe(false);
    const u = setup({ op: "add", count: 10 });
    const failing = u.runner.oneShot(body);
    await flush();
    u.polls[0].reject(new ApiError(500, "boom", "no"));
    await expect(failing).resolves.toBe(false);
  });
});

describe("runner candidate after a late params change (E2E-27 probe)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("UI-1268 a candidate stale twice before the protection PUT lands is re-requested at the new params revision and Candidates leaves —", async () => {
    const t = setup({ count: 10 });
    t.store.set({ tool: "none", liveFirst: false });
    const candidates = () => statusItems(t.store.get()).find((i) => i.label === "Candidates")?.value;
    t.runner.paramsChanged("protection");
    await vi.advanceTimersByTimeAsync(300);
    await flush();
    expect(t.api.submitCandidate).toHaveBeenCalledTimes(1);
    t.polls[0].reject(new ApiError(409, "stale", "the job ended as stale"));
    await flush();
    expect(t.api.submitCandidate).toHaveBeenCalledTimes(2); // the one retry
    t.polls[1].reject(new ApiError(409, "stale", "the job ended as stale"));
    await flush();
    expect(candidates()).toBe("—");
    // the protection PUT (switch to override) lands only now: the controller stores its session and calls the params hook
    const sess = t.store.get().session!;
    t.store.set({ session: { ...sess, revision: { ...sess.revision, params: 5 } } });
    t.runner.paramsChanged("protection");
    await vi.advanceTimersByTimeAsync(300);
    await flush();
    expect(t.api.submitCandidate).toHaveBeenCalledTimes(3);
    t.polls[2].resolve({ candidate: candidateFixture({ params_revision: 5, candidates: 7 }) });
    await flush();
    expect(t.store.get().candidate?.params_revision).toBe(5);
    expect(candidates()).toBe("7");
  });
});
