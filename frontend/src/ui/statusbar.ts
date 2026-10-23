import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import { footerItems, modeIndicator } from "../status/model";
import { control } from "./controls";
import { h } from "./dom";

export interface StatusbarActions {
  /** The footer's Invalid value is a link that opens Cloud details. */
  openDetails: () => void;
}

const INVALID = "Invalid (active/total)";

export function buildStatusbar(bar: HTMLElement, mode: HTMLElement, store: Store<AppState>, a: StatusbarActions): void {
  // one registered button, created on first use and re-attached on each render (the registry rejects a second id)
  let invalid: HTMLButtonElement | undefined;
  const invalidButton = (value: string): HTMLButtonElement => {
    invalid ??= control("button", { id: "status-invalid", type: "button", class: "link", onclick: a.openDetails });
    invalid.textContent = value;
    return invalid;
  };
  const render = (s: AppState) => {
    const text = modeIndicator(s);
    mode.textContent = text;
    mode.title = text;
    const items = footerItems(s);
    bar.replaceChildren(
      ...(items.length === 0
        ? [h("span", { class: "item", text: "No file open" })]
        : items.map((i) =>
            h(
              "span",
              { class: "item", "data-status": i.label },
              h("b", { text: `${i.label}: ` }),
              i.label === INVALID ? invalidButton(i.value) : i.value,
            ),
          )),
    );
    bar.dataset.ready = "1";
  };
  store.subscribe(render);
  render(store.get());
}
