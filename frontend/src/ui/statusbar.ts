import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import { modeIndicator, statusItems } from "../status/model";
import { h } from "./dom";

export function buildStatusbar(bar: HTMLElement, mode: HTMLElement, store: Store<AppState>): void {
  const render = (s: AppState) => {
    mode.textContent = modeIndicator(s);
    const items = statusItems(s);
    bar.replaceChildren(
      ...(items.length === 0
        ? [h("span", { class: "item", text: "No file open" })]
        : items.map((i) =>
            h("span", { class: "item", "data-status": i.label }, h("b", { text: `${i.label}: ` }), i.value),
          )),
    );
    bar.dataset.ready = "1";
  };
  store.subscribe(render);
  render(store.get());
}
