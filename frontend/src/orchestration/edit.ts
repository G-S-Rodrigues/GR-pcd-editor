import { ApiError } from "../files/errors";
import { resetOperation } from "../inspector/protection";
import { type AppState, addNotice } from "../state/app";
import type { Store } from "../state/store";
import type { SessionState } from "../state/types";
import { deleteStepText, discardCount, discardText, stepsOf } from "../timeline/model";
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
}

/** Deleting half of the active points or more is almost never intended: ask first. */
export const BULK_DELETE_FRACTION = 0.5;
export const applyNeedsConfirm = (candidates: number, active: number): boolean =>
  active > 0 && candidates >= active * BULK_DELETE_FRACTION;

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
    store.set({ session: state, candidate: null, draft: false, ...extra });
    await api.refreshRender();
  }

  async function guarded(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        store.set({ candidate: null });
        await api.refreshState().catch(() => undefined);
        addNotice(store, "warn", "stale_revision", "The cloud changed; preview again");
        return;
      }
      addNotice(store, "error", "edit_failed", e instanceof Error ? e.message : "The edit failed");
    }
  }

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
      const state = await api.apply(rev(), c.candidate_id, `Delete ${c.candidates} points (${tool})`);
      await afterChange(state, {
        tools: { ...store.get().tools, protection: resetOperation(store.get().tools.protection) },
      });
    });
  }

  return {
    async apply(): Promise<void> {
      if (applying) return;
      applying = true;
      try {
        await applyOnce();
      } finally {
        applying = false;
      }
    },
    async undo(): Promise<void> {
      if (!store.get().session?.history.can_undo || store.get().job.busy) return;
      await guarded(async () => afterChange(await api.undo(rev())));
    },
    async redo(): Promise<void> {
      if (!store.get().session?.history.can_redo || store.get().job.busy) return;
      await guarded(async () => afterChange(await api.redo(rev())));
    },
    /** Moves the history marker to `cursor` (0..steps): later steps become greyed, earlier ones are applied. */
    async rollback(cursor: number): Promise<void> {
      const s = store.get().session;
      if (!s || store.get().job.busy || cursor === s.history.cursor || !api.rollback) return;
      const call = api.rollback;
      await guarded(async () => afterChange(await call(rev(), cursor)));
    },
    /** Removes one step (after a confirmation); the later steps stay. Not undoable. */
    async deleteStep(sid: number): Promise<void> {
      const s = store.get();
      const step = stepsOf(s.session).find((x) => x.sid === sid);
      if (!step || s.job.busy || !api.deleteStep) return;
      if (!confirmFn(deleteStepText(step.label, step.count))) return;
      const call = api.deleteStep;
      await guarded(async () => afterChange(await call(rev(), sid)));
    },
    /** A name changes nothing in the cloud: the candidate and the render stay. '' clears the name. */
    async renameStep(sid: number, name: string): Promise<void> {
      if (!api.renameStep) return;
      const call = api.renameStep;
      await guarded(async () => store.set({ session: await call(sid, name) }));
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
