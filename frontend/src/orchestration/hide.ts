import type { AppState } from "../state/app";
import { addNotice } from "../state/app";
import type { Store } from "../state/store";
import { HIDE_LABEL, SHOW_LABEL, hiddenPointCount } from "../layers/model";

export interface HideState {
  label: string;
  /** Points are in hidden layers: the button shows them again. */
  pressed: boolean;
  /** Why the button is inactive now, or null. */
  reason: string | null;
}

/** The "Hide selected" / "Show hidden (N)" button for this state. One place for label, pressed and reasons. */
export function hideState(s: AppState): HideState {
  const n = hiddenPointCount(s.session);
  if (n > 0) return { label: SHOW_LABEL(n), pressed: true, reason: s.session ? null : "No file is open" };
  const reason = !s.session
    ? "No file is open"
    : s.compare !== "edited"
      ? "Return to the edited view to hide points"
      : s.draft || s.preview
        ? "Commit or discard the draft first"
        : s.session.selection.count === 0
          ? "Select some points first"
          : null;
  return { label: HIDE_LABEL, pressed: false, reason };
}

export interface HideDeps {
  /** Moves the selection into the layer "Hidden" and hides it (one server call). */
  hideSelected(): Promise<void>;
  /** Shows every hidden layer again. */
  showAll(): Promise<void>;
}

export function createHide(store: Store<AppState>, deps: HideDeps) {
  async function hide(): Promise<void> {
    const why = hideState(store.get()).reason;
    if (why) {
      addNotice(store, "info", "hide_disabled", why);
      return;
    }
    await deps.hideSelected();
  }
  return {
    toggle: (): Promise<void> => (hiddenPointCount(store.get().session) > 0 ? deps.showAll() : hide()),
    hide,
    show: (): Promise<void> => deps.showAll(),
  };
}
