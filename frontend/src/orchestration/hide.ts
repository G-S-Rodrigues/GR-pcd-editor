import { type AppState, addNotice } from "../state/app";
import type { Store } from "../state/store";
import { HIDDEN_SEED_TEXT, HIDE_LABEL, SHOW_LABEL, emptyHidden, hidePartialText, isHidden, stashSelected, type HiddenSet } from "../view/hidden";

export interface HideState {
  label: string;
  /** The set is non-empty: the button shows them again. */
  pressed: boolean;
  /** Why the button is inactive now, or null. */
  reason: string | null;
}

/** The "Hide selected" / "Show hidden (N)" button for this state. One place for label, pressed and reasons. */
export function hideState(s: AppState): HideState {
  const n = s.hidden.size;
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

/** Apply asks once more while points are hidden: the selection may include hidden points inside the shape. */
export const applyNeedsHiddenConfirm = (hidden: HiddenSet): boolean => hidden.size > 0;

/** A picked seed that is hidden is refused: the server does not know the set. Null when the pick is allowed. */
export const seedHiddenReason = (hidden: HiddenSet, id: number): string | null => (isHidden(hidden, id) ? HIDDEN_SEED_TEXT : null);

export interface HideDeps {
  /** Clears the selection through the server route only: it must not disarm the tool. */
  clearSelection(): Promise<void>;
  refresh(): Promise<unknown>;
}

export function createHide(store: Store<AppState>, deps: HideDeps) {
  async function hide(): Promise<void> {
    const s = store.get();
    const why = hideState(s).reason;
    if (why) {
      addNotice(store, "info", "hide_disabled", why);
      return;
    }
    if (!s.session || !s.render) return;
    const r = stashSelected(s.hidden, s.render, s.session.session_id, s.session.counts.original, s.session.selection.count);
    store.set({ hidden: r.hidden });
    if (!r.exact) addNotice(store, "warn", "hide_partial", hidePartialText(r.flagged, s.session.selection.count));
    await deps.clearSelection();
  }
  async function show(): Promise<void> {
    store.set({ hidden: emptyHidden() });
    await deps.refresh();
  }
  return {
    toggle: (): Promise<void> => (store.get().hidden.size > 0 ? show() : hide()),
    hide,
    show,
  };
}
