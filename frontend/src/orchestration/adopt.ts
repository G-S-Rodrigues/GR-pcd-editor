import { getState } from "../api/session";
import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import type { SessionState } from "../state/types";

/**
 * Page load: adopt the session the server already holds (a reload keeps its file).
 * The GET can answer after the user has opened another file (or while its upload is
 * still running); that answer is older than the open, so it is dropped.
 */
export async function adoptExisting(
  store: Store<AppState>,
  deps: { onOpened: (state: SessionState) => void; refresh: () => Promise<unknown> },
): Promise<boolean> {
  const before = store.get().session;
  const state = await getState().catch(() => undefined);
  if (!state) return false;
  const now = store.get();
  if (now.session !== before || now.upload) return false;
  store.set({ session: state });
  deps.onOpened(state);
  await deps.refresh();
  return true;
}
