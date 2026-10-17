import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import { h } from "./dom";
import { type SectionId, isSectionOpen, setSectionOpen } from "./sections";

export const FOLD_TOOLTIP = "Fold or unfold this section";

/** A native details/summary panel section whose open state lives in `AppState.sectionsOpen`. `sync` pulls the state onto the element. */
export function foldable(store: Store<AppState>, id: SectionId, title: Node, ...kids: (Node | null)[]) {
  const el = h("details", { class: "panel", "data-section": id, open: true }, h("summary", { title: FOLD_TOOLTIP }, title), ...kids);
  el.addEventListener("toggle", () => {
    if (el.open !== isSectionOpen(store.get().sectionsOpen, id)) store.update((s) => ({ ...s, sectionsOpen: setSectionOpen(s.sectionsOpen, id, el.open) }));
  });
  const sync = (s: AppState): void => {
    const want = isSectionOpen(s.sectionsOpen, id);
    if (el.open !== want) el.open = want;
  };
  sync(store.get());
  return { el, sync };
}
