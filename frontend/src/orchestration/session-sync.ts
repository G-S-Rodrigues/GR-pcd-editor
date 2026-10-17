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
    /** On window focus: compare the server's session with ours. */
    async check(): Promise<void> {
      const mine = store.get().session;
      if (!mine) return;
      const state = await getState().catch(() => undefined);
      if (state === undefined) return;
      if (state && state.session_id === mine.session_id && state.revision.cloud === mine.revision.cloud) return;
      await reload(CHANGED_TEXT);
    },
  };
}
