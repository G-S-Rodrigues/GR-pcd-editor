import { ApiError } from "../files/errors";
import { resetOperation } from "../inspector/protection";
import { type AppState, addNotice } from "../state/app";
import type { Store } from "../state/store";
import type { SessionState } from "../state/types";
import { deleteStepText, discardCount, discardText, mergeStepNames, stepsOf } from "../timeline/model";
import { emptyPolygon } from "../tools/polygon/model";
import { canApply } from "./runner";

export interface EditApi {
  apply(cloudRevision: number, candidateId: string, description: string): Promise<SessionState>;
  undo(cloudRevision: number): Promise<SessionState>;
  redo(cloudRevision: number): Promise<SessionState>;
  removeInvalid(cloudRevision: number): Promise<SessionState>;
  rollback?(cloudRevision: number, cursor: number): Promise<SessionState>;
  deleteStep?(cloudRevision: number, sid: number): Promise<SessionState>;
  renameStep?(sid: number, name: string): Promise<SessionState>;
  clearSelection(cloudRevision: number): Promise<SessionState>;
  refreshState(): Promise<void>;
  refreshRender(): Promise<boolean>;
  /** False when another tab replaced or changed the session (already reloaded, with a notice). */
  checkSession?(): Promise<boolean>;
  /** Cancels a running or pending preview before Apply deletes the committed selection. */
  supersedePreview?(): void;
}

/** Deleting half of the active points or more is almost never intended: ask first. */
export const BULK_DELETE_FRACTION = 0.5;
export const applyNeedsConfirm = (candidates: number, active: number): boolean =>
  active > 0 && candidates >= active * BULK_DELETE_FRACTION;

export const STALE_PREVIEW_TEXT = "The cloud changed; preview again";
export const STALE_HISTORY_TEXT = "The history changed; it was reloaded";
export const BUSY_TEXT = "A job is still running; try again when it finishes";

export type KeyAction = "undo" | "redo" | null;
export function keyAction(e: { key: string; ctrlKey: boolean; shiftKey: boolean; target: string }): KeyAction {
  if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target)) return null;
  if (!e.ctrlKey) return null;
  const k = e.key.toLowerCase();
  if (k === "z") return e.shiftKey ? "redo" : "undo";
  if (k === "y") return "redo";
  return null;
}

export function createEditor(store: Store<AppState>, api: EditApi, confirmFn: (m: string) => boolean) {
  const rev = () => store.get().session?.revision.cloud ?? 0;

  async function afterChange(state: SessionState, extra: Partial<AppState> = {}): Promise<void> {
    store.set({ session: state, candidate: null, draft: false, preview: null, liveFirst: state.selection.count === 0, ...extra });
    await api.refreshRender();
  }

  /** `staleText`: what a 409 says. A history gesture is not a preview, so it must not tell the user to preview again. */
  async function guarded(fn: () => Promise<void>, staleText = STALE_PREVIEW_TEXT): Promise<void> {
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        store.set({ candidate: null });
        await api.refreshState().catch(() => undefined);
        addNotice(store, "warn", "stale_revision", staleText);
        return;
      }
      addNotice(store, "error", "edit_failed", e instanceof Error ? e.message : "The edit failed");
    }
  }

  const busyNotice = (): void => addNotice(store, "info", "busy", BUSY_TEXT);

  // History gestures (undo, redo, marker moves, step delete) run one at a time: each reads the revision when it starts,
  // so rapid keys or clicks never send a request with a revision the previous one just made stale (a 409).
  let tail: Promise<void> = Promise.resolve();
  const serial = (task: () => Promise<void>): Promise<void> => {
    const run = tail.then(task);
    tail = run.catch(() => undefined);
    return run;
  };
  let queuedCursor: number | null = null; // a marker move that has not started: a newer one replaces it
  let outstanding: number | null = null; // the latest marker target asked for, queued or in flight

  let applying = false; // a second click while the first Apply is in flight is ignored

  async function applyOnce(): Promise<void> {
    const s = store.get();
    if (!canApply(s) || !s.candidate) return;
    const c = s.candidate;
    const tool = s.tool === "none" ? "selection" : s.tool;
    const active = s.session?.counts.active ?? 0;
    const bulk = applyNeedsConfirm(c.candidates, active);
    const discard = discardCount(s.session);
    if (bulk || discard > 0) {
      // ask about the session the server really has: a replaced one reloads with its own notice instead
      if (api.checkSession && !(await api.checkSession())) return;
    }
    if (bulk) {
      const pct = Math.round((c.candidates / active) * 100);
      const fmt = (n: number) => n.toLocaleString("en-US");
      if (!confirmFn(`This deletes ${fmt(c.candidates)} of ${fmt(active)} points (${pct} %). It can be undone. Continue?`)) return;
    }
    // applying while rolled back throws the greyed steps away on the server: say so first
    if (discard > 0 && !confirmFn(discardText(discard))) return;
    await guarded(async () => {
      api.supersedePreview?.();
      const state = await api.apply(rev(), c.candidate_id, `Delete ${c.candidates} points (${tool})`);
      await afterChange(state, {
        tools: {
          ...store.get().tools,
          protection: resetOperation(store.get().tools.protection),
          // the polygon that made the deleted points is spent: the tool stays armed with a blank polygon for the next shape
          polygon: tool === "polygon" ? emptyPolygon() : store.get().tools.polygon,
        },
      });
    });
  }

  return {
    async apply(): Promise<void> {
      if (applying) return;
      applying = true;
      try {
        await serial(applyOnce);
      } finally {
        applying = false;
      }
    },
    async undo(): Promise<void> {
      return serial(async () => {
        if (!store.get().session?.history.can_undo) return;
        if (store.get().job.busy) return busyNotice();
        await guarded(async () => afterChange(await api.undo(rev())), STALE_HISTORY_TEXT);
      });
    },
    async redo(): Promise<void> {
      return serial(async () => {
        if (!store.get().session?.history.can_redo) return;
        if (store.get().job.busy) return busyNotice();
        await guarded(async () => afterChange(await api.redo(rev())), STALE_HISTORY_TEXT);
      });
    },
    /** The marker target most recently asked for and not yet answered (keys move relative to it), or null. */
    pendingCursor: (): number | null => outstanding,
    /**
     * Moves the history marker to `cursor` (0..steps): later steps become greyed, earlier ones are applied. Rapid calls
     * are coalesced: only the newest target is sent once the one in flight has been answered.
     */
    async rollback(cursor: number): Promise<void> {
      const s = store.get().session;
      if (!s || !api.rollback) return;
      if (store.get().job.busy) return busyNotice();
      if (cursor === (outstanding ?? s.history.cursor)) return;
      outstanding = cursor;
      if (queuedCursor !== null) {
        queuedCursor = cursor;
        return;
      }
      queuedCursor = cursor;
      const call = api.rollback;
      await serial(async () => {
        const to = queuedCursor;
        queuedCursor = null;
        try {
          const now = store.get().session;
          if (to === null || !now || to === now.history.cursor) return;
          if (store.get().job.busy) return busyNotice();
          await guarded(async () => afterChange(await call(rev(), to)), STALE_HISTORY_TEXT);
        } finally {
          if (queuedCursor === null) outstanding = null;
        }
      });
    },
    /** Removes one step (after a confirmation); the later steps stay. Not undoable. */
    async deleteStep(sid: number): Promise<void> {
      const s = store.get();
      const step = stepsOf(s.session).find((x) => x.sid === sid);
      if (!step || !api.deleteStep) return;
      if (s.job.busy) return busyNotice();
      if (!confirmFn(deleteStepText(step.label, step.count))) return;
      const call = api.deleteStep;
      await serial(async () => {
        if (!stepsOf(store.get().session).some((x) => x.sid === sid)) return;
        if (store.get().job.busy) return busyNotice();
        await guarded(async () => afterChange(await call(rev(), sid)), STALE_HISTORY_TEXT);
      });
    },
    /** A name changes nothing in the cloud: the candidate and the render stay. '' clears the name. Only the names are taken from the answer, so a late answer cannot overwrite a newer snapshot. */
    async renameStep(sid: number, name: string): Promise<void> {
      if (!api.renameStep) return;
      const call = api.renameStep;
      await guarded(async () => {
        const answer = await call(sid, name);
        store.update((s) => ({ ...s, session: s.session ? mergeStepNames(s.session, answer) : s.session }));
      });
    },
    async clearSelection(): Promise<void> {
      await guarded(async () => afterChange(await api.clearSelection(rev())));
    },
    removeInvalidVisible: (): boolean => (store.get().session?.counts.invalid_active ?? 0) > 0,
    removeInvalidLabel: (): string =>
      `Remove ${(store.get().session?.counts.invalid_active ?? 0).toLocaleString("en-US")} invalid points`,
    async removeInvalid(): Promise<void> {
      const n = store.get().session?.counts.invalid_active ?? 0;
      if (n === 0) return;
      if (!confirmFn(`Remove ${n} invalid (NaN/Infinity) points from the active cloud? This can be undone.`)) return;
      await guarded(async () => afterChange(await api.removeInvalid(rev())));
    },
  };
}
