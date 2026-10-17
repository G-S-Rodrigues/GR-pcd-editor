import { getState } from "../api/session";
import { type AppState, addNotice } from "../state/app";
import type { Store } from "../state/store";

export const REPLACED_TEXT = "This session was replaced in another tab; reloaded";
export const CHANGED_TEXT = "This session changed in another tab; reloaded";

/** Keeps this tab honest when another tab replaced or edited the session. */
export function createSessionSync(
  store: Store<AppState>,
  deps: { clear: () => void; refresh: () => Promise<unknown> },
) {
  async function reload(text: string): Promise<void> {
    const state = await getState().catch(() => undefined);
    if (state === undefined) return;
    deps.clear();
    store.batch(() => {
      store.set({ session: state, candidate: null, render: null, render2: null });
    });
    addNotice(store, "warn", "session_changed", text);
    await deps.refresh();
  }
  return {
    /** A request answered 409 session_changed. */
    onChanged: () => reload(REPLACED_TEXT),
    /** On window focus and before a bulk-delete confirm: true when the server's session is still ours. */
    async check(): Promise<boolean> {
      const mine = store.get().session;
      if (!mine) return true;
      const state = await getState().catch(() => undefined);
      if (state === undefined) return true; // unreachable: let the real request report it
      if (state && state.session_id === mine.session_id && state.revision.cloud === mine.revision.cloud) return true;
      await reload(CHANGED_TEXT);
      return false;
    },
  };
}
