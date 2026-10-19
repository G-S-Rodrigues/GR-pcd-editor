import { ApiError } from "../files/errors";
import { protectionBlock } from "../inspector/protection";
import { type AppState, addNotice } from "../state/app";
import type { Store } from "../state/store";
import type { Candidate, PreviewState } from "../state/types";
import { clusterErrorText } from "../tools/cluster/model";
import { type SelectionRequest, buildSelection, shouldPreview } from "./selection";
import { createDebouncer } from "./timing";

export interface RunnerApi {
  submitSelection(body: unknown): Promise<{ id: string }>;
  submitCandidate(cloudRevision: number): Promise<{ id: string }>;
  /** Computes `S OP shape` as a pending preview without changing the selection. */
  submitPreview(body: unknown): Promise<{ id: string }>;
  /** Installs the pending preview with that id as the selection. */
  submitCommit(body: { cloud_revision: number; preview_id: string }): Promise<{ id: string }>;
  /** Best effort: frees the server's pending preview. */
  discardPreview?(cloudRevision: number): Promise<unknown>;
  cancelJob(id: string): Promise<unknown>;
  /** Best-effort cancel that survives the page closing (navigator.sendBeacon). */
  beaconCancel?(id: string): void;
  poll(
    id: string,
    opts: { signal?: AbortSignal; onProgress?: (p: number | null, m: string | null) => void },
  ): Promise<Record<string, unknown>>;
  /** Re-reads the session state into the store and refreshes the render (counts, flags). */
  refreshState(): Promise<void>;
}

export type ParamsKind = "filter" | "scope" | "protection";
export const OUTDATED_TEXT = "The display filter changed since this selection was made. Select again to refresh the preview.";

export const PREVIEW_REFRESHED_TEXT = "The selection changed; the preview was refreshed. Check it and commit again.";
export const TOOL_DEBOUNCE_MS = 250;
export const PARAMS_DEBOUNCE_MS = 300;
const IDLE = { busy: false, progress: null, message: null } as const;

/** Apply is enabled only for a candidate that matches the current revisions, with no job pending. A draft does not block it: Apply deletes the committed selection only. */
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
    protectionBlock(s.tools.protection) === null
  );
}

/** Why Apply is disabled for a session in the edited view (the tooltip); the order matches what canApply checks. */
export function applyBlockedText(s: AppState): string {
  if (!s.session) return "no file open";
  if (s.compare !== "edited") return "return to the edited view";
  if (s.job.busy) return "a job is running";
  const p = protectionBlock(s.tools.protection);
  if (p) return p;
  if ((s.candidate?.cluster as { complete?: boolean } | null | undefined)?.complete === false) {
    return "the cluster stopped at its Max points limit and is not complete; raise Max points or clear the field";
  }
  return s.candidate ? "the preview is out of date or empty; preview again" : "preview a selection first";
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
    previewRunning = false;
    return mine;
  };

  /** Bumped by every shape edit; a preview is current only if it was submitted for the latest one. */
  let shape = 0;
  let previewShape = -1;
  let previewRunning = false;
  let runningShape = -1;
  let commitWhenReady = false;
  /** Bumped whenever the committed selection or its candidate is invalidated or a selection/candidate/commit job starts. */
  let epoch = 0;

  const previewCurrent = (): boolean => {
    const s = store.get();
    return s.preview !== null && s.preview.op === s.op && previewShape === shape && !s.job.busy && !toolDebounce.pending();
  };

  async function run(
    submit: () => Promise<{ id: string }>,
    message: string,
    retried: boolean,
    kind: "select" | "preview" | "commit" = "select",
  ): Promise<void> {
    const mine = supersede();
    ctl = new AbortController();
    const signal = ctl.signal;
    store.set({ job: { busy: true, progress: null, message } });
    previewRunning = kind === "preview";
    const mineEpoch = kind === "preview" ? epoch : ++epoch;
    const submittedShape = shape;
    runningShape = submittedShape;
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
      if (kind === "preview") {
        const r = result as unknown as { preview_id: string } & Omit<PreviewState, "id" | "op">;
        const op = store.get().op as PreviewState["op"];
        store.set({
          preview: {
            id: r.preview_id,
            op,
            selected_after: r.selected_after,
            base_selected: r.base_selected,
            added: r.added,
            removed: r.removed,
            ...(r.cluster !== undefined ? { cluster: r.cluster } : {}),
          },
        });
        previewShape = submittedShape;
        await api.refreshState(); // draws the preview (the refresher passes its id)
        if (mine !== gen) return;
        previewRunning = false;
        store.set({ job: { ...IDLE } });
        if (commitWhenReady && previewCurrent()) {
          commitWhenReady = false;
          commitNow();
        }
        return;
      }
      const raw = (result as { candidate?: unknown }).candidate ?? ("candidate_id" in result ? result : null);
      await api.refreshState();
      if (mine !== gen) {
        // Superseded while the state refresh was in flight. The server already installed this selection (and its pending
        // preview, if any, belongs to the newer edit's own job), so when the superseding edit was only a draft over it the
        // candidate is still the committed selection's: keep it, or Apply stays disabled for good. A superseder that
        // invalidated the selection (live re-select, params change, reset, another selection job) bumped the epoch.
        if (epoch === mineEpoch) {
          store.set({
            candidate: (raw as Candidate | null) ?? null,
            ...(kind === "commit" ? { liveFirst: false } : {}),
          });
        }
        return;
      }
      store.set({
        candidate: (raw as Candidate | null) ?? null,
        job: { ...IDLE },
        draft: false,
        preview: null,
        ...(kind === "commit" ? { liveFirst: false } : {}),
      });
    } catch (e) {
      if (mine !== gen) return;
      jobId = null;
      previewRunning = false;
      const code = e instanceof ApiError ? e.code : "";
      store.set({ job: { ...IDLE } });
      if (kind === "commit" && code === "stale_revision") {
        // the previewed mask is obsolete: look again at the new truth before anything is committed
        store.set({ preview: null });
        await api.refreshState().catch(() => undefined);
        if (mine !== gen) return;
        addNotice(store, "warn", "preview_refreshed", PREVIEW_REFRESHED_TEXT);
        if (!retried) previewDraft();
        return;
      }
      if (code === "stale") {
        if (!retried) {
          await api.refreshState().catch(() => undefined);
          if (mine === gen) await run(submit, message, true);
        }
        return;
      }
      if (code === "cancelled") return;
      commitWhenReady = false;
      if (kind === "preview") store.set({ preview: null });
      else store.set({ candidate: null });
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

  /** Computes the pending preview of the drafted shape (never touches the selection or the candidate). */
  function previewDraft(): void {
    const built = buildSelection(store.get());
    if (!built.ok || built.body.tool === null) {
      commitWhenReady = false;
      store.set({ job: { ...IDLE } });
      return;
    }
    void run(
      () => {
        const again = buildSelection(store.get());
        const { evaluate_candidate: _drop, ...body } = again.ok ? again.body : built.body;
        return api.submitPreview(body);
      },
      "Computing preview...",
      false,
      "preview",
    );
  }

  function commitNow(): void {
    const s = store.get();
    const id = s.preview?.id;
    if (!id) return;
    void run(() => api.submitCommit({ cloud_revision: store.get().session?.revision.cloud ?? 0, preview_id: id }), "Committing preview", false, "commit");
  }

  /** Drops the pending preview and the draft flag: client state, plus a best-effort release on the server. */
  function dropDraft(): void {
    const had = store.get().preview !== null;
    commitWhenReady = false;
    shape++;
    store.set({ preview: null, draft: false });
    if (had) void api.discardPreview?.(store.get().session?.revision.cloud ?? 0)?.catch(() => undefined);
  }

  return {
    /** Single entry for every tool change (numeric field or handle drag). */
    onToolChanged(): void {
      const s = store.get();
      supersede();
      toolDebounce.cancel();
      shape++;
      commitWhenReady = false;
      if (shouldPreview(s)) {
        // the committed candidate stays: Apply keeps deleting the committed selection while the draft is shown
        if (!s.previewLive) {
          // Preview off: the outline moves, nothing is computed; an older preview no longer matches the shape
          store.set({ job: { ...IDLE }, draft: true, preview: null });
          if (s.preview !== null) {
            void api.discardPreview?.(s.session?.revision.cloud ?? 0)?.catch(() => undefined);
            void api.refreshState().catch(() => undefined);
          }
          return;
        }
        store.set({ job: { ...IDLE }, draft: true });
        toolDebounce.call(previewDraft);
        return;
      }
      const had = s.preview !== null;
      epoch++;
      store.set({ candidate: null, job: { ...IDLE }, draft: false, preview: null });
      if (had) {
        void api.discardPreview?.(s.session?.revision.cloud ?? 0)?.catch(() => undefined);
        void api.refreshState().catch(() => undefined);
      }
      toolDebounce.call(selectionNow);
    },
    /**
     * Commit the drafted shape: installs the previewed mask by id. With no current preview it previews first
     * and commits that preview when it lands (never a mask the user has not been shown).
     */
    commitDraft(): void {
      toolDebounce.cancel();
      const s = store.get();
      if (!s.draft && !s.preview) {
        selectionNow(); // one-shot callers with nothing drafted
        return;
      }
      if (previewCurrent()) {
        commitNow();
        return;
      }
      commitWhenReady = true;
      if (!(previewRunning && runningShape === shape)) previewDraft();
    },
    /** Esc, the Discard draft button, Clear: forget the drafted preview; selection, history and candidate stay. */
    discardDraft(): void {
      supersede();
      toolDebounce.cancel();
      store.set({ job: { ...IDLE } });
      dropDraft();
      void api.refreshState().catch(() => undefined);
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
      if (s.draft) {
        // a pending Add/Subtract/Intersect draft has no count to preview; evaluating the old selection would drop the draft silently
        addNotice(store, "warn", "draft_pending", "Commit or discard the drafted tool shape first; Preview would not include it");
        return;
      }
      if (!shouldPreview(s) && buildSelection(s).ok) selectionNow();
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
      const hadPreview = store.get().preview !== null;
      epoch++;
      store.set({ candidate: null, job: { ...IDLE }, preview: null });
      const s = store.get();
      if (hadPreview && shouldPreview(s) && buildSelection(s).ok) {
        // the server dropped its pending preview with the params change; look at the same shape again
        shape++;
        store.set({ draft: true });
        if (s.previewLive) paramsDebounce.call(previewDraft);
        return;
      }
      const live = s.liveFirst && s.tool !== "none" && buildSelection(s).ok;
      const reselect = live && (kind !== "protection" || s.tool === "cluster" || s.tool === "sparse");
      if (reselect) {
        store.set({ draft: false });
        paramsDebounce.call(selectionNow);
      } else if ((s.session?.selection.count ?? 0) > 0) paramsDebounce.call(candidateNow);
    },
    /** The page is going away: ask the server to stop the in-flight job (the server also sweeps unpolled jobs). */
    onPageHide(): void {
      if (jobId) api.beaconCancel?.(jobId);
    },
    /** Drops the in-flight job and any pending timers (selection cleared, new file, ...). */
    reset(): void {
      supersede();
      toolDebounce.cancel();
      paramsDebounce.cancel();
      epoch++;
      store.set({ candidate: null, job: { ...IDLE } });
      dropDraft();
    },
  };
}
