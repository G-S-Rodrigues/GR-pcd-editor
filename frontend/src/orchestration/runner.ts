import { ApiError } from "../files/errors";
import { protectionBlock } from "../inspector/protection";
import { type AppState, addNotice } from "../state/app";
import type { Store } from "../state/store";
import type { Candidate } from "../state/types";
import { clusterErrorText } from "../tools/cluster/model";
import { type SelectionRequest, buildSelection, isDraftOp } from "./selection";
import { createDebouncer } from "./timing";

export interface RunnerApi {
  submitSelection(body: unknown): Promise<{ id: string }>;
  submitCandidate(cloudRevision: number): Promise<{ id: string }>;
  cancelJob(id: string): Promise<unknown>;
  poll(
    id: string,
    opts: { signal?: AbortSignal; onProgress?: (p: number | null, m: string | null) => void },
  ): Promise<Record<string, unknown>>;
  /** Re-reads the session state into the store and refreshes the render (counts, flags). */
  refreshState(): Promise<void>;
}

export type ParamsKind = "filter" | "scope" | "protection";
export const OUTDATED_TEXT = "The display filter changed since this selection was made. Select again to refresh the preview.";

export const TOOL_DEBOUNCE_MS = 250;
export const PARAMS_DEBOUNCE_MS = 300;
const IDLE = { busy: false, progress: null, message: null } as const;

/** Apply is enabled only for a candidate that matches the current revisions, with no job or draft pending. */
export function canApply(s: AppState): boolean {
  const c = s.candidate;
  const sess = s.session;
  if (!c || !sess) return false;
  if ((c.cluster as { complete?: boolean } | null)?.complete === false) return false; // a partial cluster is not what was asked for
  return (
    c.cloud_revision === sess.revision.cloud &&
    c.params_revision === sess.revision.params &&
    c.candidates > 0 &&
    !s.job.busy &&
    !s.draft &&
    protectionBlock(s.tools.protection) === null
  );
}

/** Preview orchestration: debounce, supersede (cancel the older job), drop stale results, retry a stale job once. */
export function createRunner(store: Store<AppState>, api: RunnerApi) {
  const toolDebounce = createDebouncer(TOOL_DEBOUNCE_MS);
  const paramsDebounce = createDebouncer(PARAMS_DEBOUNCE_MS);
  let gen = 0;
  let jobId: string | null = null;
  let ctl: AbortController | null = null;

  const supersede = (): number => {
    const mine = ++gen;
    ctl?.abort();
    ctl = null;
    if (jobId) void api.cancelJob(jobId).catch(() => undefined);
    jobId = null;
    return mine;
  };

  async function run(submit: () => Promise<{ id: string }>, message: string, retried: boolean): Promise<void> {
    const mine = supersede();
    ctl = new AbortController();
    const signal = ctl.signal;
    store.set({ job: { busy: true, progress: null, message } });
    try {
      const { id } = await submit();
      if (mine !== gen) {
        void api.cancelJob(id).catch(() => undefined);
        return;
      }
      jobId = id;
      const result = await api.poll(id, {
        signal,
        onProgress: (progress, m) => {
          if (mine === gen) store.set({ job: { busy: true, progress, message: m ?? message } });
        },
      });
      if (mine !== gen) return;
      jobId = null;
      await api.refreshState();
      if (mine !== gen) return;
      const raw = (result as { candidate?: unknown }).candidate ?? ("candidate_id" in result ? result : null);
      store.set({ candidate: (raw as Candidate | null) ?? null, job: { ...IDLE }, draft: false });
    } catch (e) {
      if (mine !== gen) return;
      jobId = null;
      const code = e instanceof ApiError ? e.code : "";
      store.set({ job: { ...IDLE } });
      if (code === "stale") {
        if (!retried) {
          await api.refreshState().catch(() => undefined);
          if (mine === gen) await run(submit, message, true);
        }
        return;
      }
      if (code === "cancelled") return;
      store.set({ candidate: null });
      if (code === "selection_outdated") {
        addNotice(store, "warn", code, OUTDATED_TEXT);
        return;
      }
      const text = clusterErrorText(code) ?? (e instanceof Error ? e.message : "The preview failed");
      addNotice(store, "error", code || "preview_failed", text);
    }
  }

  const selectionNow = (): void => {
    const built = buildSelection(store.get());
    if (!built.ok) {
      store.set({ job: { ...IDLE } });
      return;
    }
    // revisions are read at submit time, so a retry after a stale job uses fresh ones
    void run(
      () => {
        const again = buildSelection(store.get());
        return api.submitSelection(again.ok ? again.body : built.body);
      },
      "Evaluating selection",
      false,
    );
  };
  const candidateNow = (): void =>
    void run(() => api.submitCandidate(store.get().session?.revision.cloud ?? 0), "Evaluating candidate", false);

  return {
    /** Single entry for every tool change (numeric field or handle drag). */
    onToolChanged(): void {
      const s = store.get();
      supersede();
      toolDebounce.cancel();
      store.set({ candidate: null, job: { ...IDLE } });
      if (isDraftOp(s.op)) {
        store.set({ draft: true });
        return;
      }
      store.set({ draft: false });
      toolDebounce.call(selectionNow);
    },
    /** Explicit commit of an Add/Subtract/Intersect draft (or any one-shot such as Invert). */
    commitDraft(): void {
      toolDebounce.cancel();
      store.set({ draft: false });
      selectionNow();
    },
    /** One-shot selection (Select displayed, Invert): sent at once, independent of the tool. */
    oneShot(make: (cloudRevision: number) => SelectionRequest): void {
      toolDebounce.cancel();
      store.set({ draft: false });
      void run(() => api.submitSelection(make(store.get().session?.revision.cloud ?? 0)), "Evaluating selection", false);
    },
    /** The Preview button: recompute now. */
    previewNow(): void {
      toolDebounce.cancel();
      const s = store.get();
      if (!isDraftOp(s.op) && buildSelection(s).ok) selectionNow();
      else if ((s.session?.selection.count ?? 0) > 0) candidateNow();
    },
    /**
     * Filter, scope or protection changed: the candidate is obsolete at once. A live tool re-selects
     * (the stored selection was built under the old filter or scope); protection alone only needs a new candidate.
     */
    paramsChanged(kind: ParamsKind = "protection"): void {
      supersede();
      toolDebounce.cancel();
      paramsDebounce.cancel();
      store.set({ candidate: null, job: { ...IDLE } });
      const s = store.get();
      const live = s.op === "replace" && s.tool !== "none" && buildSelection(s).ok;
      const reselect = live && (kind !== "protection" || s.tool === "cluster");
      if (reselect) {
        store.set({ draft: false });
        paramsDebounce.call(selectionNow);
      } else if ((s.session?.selection.count ?? 0) > 0) paramsDebounce.call(candidateNow);
    },
    /** Drops the in-flight job and any pending timers (selection cleared, new file, ...). */
    reset(): void {
      supersede();
      toolDebounce.cancel();
      paramsDebounce.cancel();
      store.set({ candidate: null, job: { ...IDLE }, draft: false });
    },
  };
}
