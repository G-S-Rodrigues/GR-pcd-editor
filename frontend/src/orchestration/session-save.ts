import type { Download } from "../files/downloads";
import { type AppState, addNotice } from "../state/app";
import type { Store } from "../state/store";
import type { SessionState } from "../state/types";

export interface SaveDeps {
  startSave(): Promise<Download & { archiveId: string }>;
  markSaved(archiveId: string): Promise<SessionState>;
  /** Sends the pending client state first, so the archive carries the current folds and camera. */
  flushClientState?(): Promise<void>;
}

/** Download the session archive, then mark it saved. "Started" because the browser owns the file. */
export async function runSave(store: Store<AppState>, deps: SaveDeps): Promise<{ ok: boolean; message: string }> {
  let dl: Awaited<ReturnType<SaveDeps["startSave"]>>;
  await deps.flushClientState?.().catch(() => undefined);
  try {
    dl = await deps.startSave();
  } catch (e) {
    const message = `Saving the session failed: ${e instanceof Error ? e.message : "unknown error"}`;
    addNotice(store, "error", "save_failed", message);
    return { ok: false, message };
  }
  try {
    const state = await deps.markSaved(dl.archiveId);
    store.set({ session: state });
  } catch (e) {
    const message = `Session download started (${dl.filename}) but it could not be marked saved: ${e instanceof Error ? e.message : "unknown error"}. Unsaved edits remain flagged.`;
    addNotice(store, "error", "mark_saved_failed", message);
    return { ok: false, message };
  }
  const message = `Session download started: ${dl.filename}. Your browser decides where it is saved; reopen it with Open from this computer.`;
  addNotice(store, "info", "save_done", message);
  return { ok: true, message };
}
