import { ApiError } from "../files/errors";
import { resetOperation } from "../inspector/protection";
import { type AppState, addNotice } from "../state/app";
import type { Store } from "../state/store";
import type { SessionState } from "../state/types";
import { canApply } from "./runner";

export interface EditApi {
  apply(cloudRevision: number, candidateId: string, description: string): Promise<SessionState>;
  undo(cloudRevision: number): Promise<SessionState>;
  redo(cloudRevision: number): Promise<SessionState>;
  removeInvalid(cloudRevision: number): Promise<SessionState>;
  clearSelection(cloudRevision: number): Promise<SessionState>;
  refreshState(): Promise<void>;
  refreshRender(): Promise<boolean>;
}

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

  return {
    async apply(): Promise<void> {
      const s = store.get();
      if (!canApply(s) || !s.candidate) return;
      const c = s.candidate;
      const tool = s.tool === "none" ? "selection" : s.tool;
      await guarded(async () => {
        const state = await api.apply(rev(), c.candidate_id, `Delete ${c.candidates} points (${tool})`);
        await afterChange(state, {
          tools: { ...store.get().tools, protection: resetOperation(store.get().tools.protection) },
        });
      });
    },
    async undo(): Promise<void> {
      if (!store.get().session?.history.can_undo || store.get().job.busy) return;
      await guarded(async () => afterChange(await api.undo(rev())));
    },
    async redo(): Promise<void> {
      if (!store.get().session?.history.can_redo || store.get().job.busy) return;
      await guarded(async () => afterChange(await api.redo(rev())));
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
