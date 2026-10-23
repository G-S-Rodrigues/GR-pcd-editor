import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import { h } from "./dom";
import { type SectionId, isSectionOpen, setSectionOpen } from "./sections";

export const FOLD_TOOLTIP = "Fold or unfold this section";

/**
 * Whether a store update may write `details.open`. The native `toggle` event is queued, so between a user's flip of
 * `el.open` and that event the store still holds the old value; writing it back then would swallow the click. The
 * element is therefore written only when the store value itself changed since the last sync (`last`).
 */
export function foldSyncStep(last: boolean | undefined, want: boolean, elOpen: boolean): { write: boolean; last: boolean } {
  return { write: want !== last && elOpen !== want, last: want };
}

/** A sync function for one details element: `read` gives the store's wanted value, `el` is written only per `foldSyncStep`. */
export function foldSyncer(el: { open: boolean }, read: (s: AppState) => boolean): (s: AppState) => void {
  let last: boolean | undefined;
  return (s) => {
    const step = foldSyncStep(last, read(s), el.open);
    last = step.last;
    if (step.write) el.open = step.last;
  };
}

/** A native details/summary panel section whose open state lives in `AppState.sectionsOpen`. `sync` pulls the state onto the element. */
export function foldable(store: Store<AppState>, id: SectionId, title: Node | Node[], ...kids: (Node | null)[]) {
  const el = h("details", { class: "panel", "data-section": id, open: true }, h("summary", { title: FOLD_TOOLTIP }, ...(Array.isArray(title) ? title : [title])), ...kids);
  el.addEventListener("toggle", () => {
    if (el.open !== isSectionOpen(store.get().sectionsOpen, id)) store.update((s) => ({ ...s, sectionsOpen: setSectionOpen(s.sectionsOpen, id, el.open) }));
  });
  const sync = foldSyncer(el, (s) => isSectionOpen(s.sectionsOpen, id));
  sync(store.get());
  return { el, sync };
}
