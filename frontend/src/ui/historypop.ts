import { historyRows } from "../inspector/history";
import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import { h } from "./dom";

/** The History popover body: the edit steps, newest last, undone ones marked; `#history-list` keeps its id. */
export function buildHistoryPopover(root: HTMLElement, store: Store<AppState>): void {
  const list = h("ol", { id: "history-list" });
  const none = h("p", { class: "note" });
  root.append(h("h4", { text: "History" }), list, none);
  const render = (s: AppState) => {
    list.replaceChildren(
      ...(s.session ? historyRows(s.session) : []).map((r) =>
        h("li", { class: r.undone ? "undone" : "", text: `${r.label} (${r.count.toLocaleString("en-US")})${r.undone ? " - undone" : ""}` }),
      ),
    );
    none.textContent = s.session && s.session.history.entries.length === 0 ? "No edits yet" : "";
  };
  store.subscribe(render);
  render(store.get());
}
