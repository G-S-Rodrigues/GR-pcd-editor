import { type AppState, addNotice } from "../state/app";
import type { Store } from "../state/store";
import { EDIT_SHAPE_UNAVAILABLE, shapeToPatch } from "../tools/shape";
import { clearHighlight } from "../timeline/model";
import { BUSY_TEXT } from "./edit";

export interface EditShapeDeps {
  /** Stops the runner's jobs and timers. */
  resetRunner(): void;
  /** Clears the selection on the server and in the store (awaited). */
  clearSelection(): Promise<void>;
  /** Asks the runner to run the freshly armed tool as a live selection. */
  toolChanged(): void;
}

export type EditShapeResult = { ok: true } | { ok: false; reason: string };

/**
 * Edit shape: reopens a history step's shape. Clears the selection, arms the tool of the shape, seeds it and starts a live
 * first selection. It never mutates the history: applying afterwards adds a new step and Undo removes only that one.
 */
export function createEditShape(store: Store<AppState>, deps: EditShapeDeps) {
  return {
    async edit(sid: number): Promise<EditShapeResult> {
      const s = store.get();
      const entry = s.session?.history.entries.find((e) => (e.sid ?? e.index) === sid);
      if (!s.session || !entry) return { ok: false, reason: "That step no longer exists" };
      if (!entry.shape) return { ok: false, reason: EDIT_SHAPE_UNAVAILABLE };
      if (s.job.busy) {
        addNotice(store, "info", "busy", BUSY_TEXT);
        return { ok: false, reason: BUSY_TEXT };
      }
      const id = s.session.session_id;
      const bounds = entry.bounds;
      const centre = bounds ? ([0, 1, 2].map((i) => (bounds.min[i] + bounds.max[i]) / 2) as [number, number, number]) : null;
      const r = shapeToPatch(entry.shape, s, centre);
      if (!r.ok) {
        addNotice(store, "warn", "edit_shape", r.reason);
        return r;
      }
      deps.resetRunner();
      await deps.clearSelection();
      if (store.get().session?.session_id !== id) return { ok: false, reason: "The session changed" };
      // the clear refreshed the state: build the patch on what the store holds now
      const again = shapeToPatch(entry.shape, store.get(), centre);
      if (!again.ok) return again;
      store.update((st) => ({ ...st, ...again.patch, timeline: clearHighlight(st.timeline) }));
      deps.toolChanged();
      return { ok: true };
    },
  };
}
