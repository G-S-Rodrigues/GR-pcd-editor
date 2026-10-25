import { KEY_DOCS, MOUSE_DOCS, helpOpenAfter, type KeyId } from "./keys";
import { h } from "./dom";
import type { Popovers } from "./popover";

/** The Keyboard popover body, filled from the one key table; its open state is the popover manager's `help` entry. `apply(id)` is fed every classified key. */
export function buildHelp(root: HTMLElement, pops: Popovers) {
  const row = (k: string, v: string) => h("tr", {}, h("td", { class: "k", text: k }), h("td", { text: v }));
  root.append(
    h("strong", { text: "Controls" }),
    h("table", { id: "help-table" }, ...MOUSE_DOCS.map((d) => row(d.keys, d.label)), ...KEY_DOCS.map((d) => row(d.keys, d.label))),
    h("p", { class: "note", text: "Press ? or Esc to close." }),
  );
  const isOpen = () => pops.openId() === "help";
  const set = (v: boolean) => {
    if (v) pops.open("help");
    else pops.closeIf("help"); // never another popover's entry
  };
  return {
    toggle: () => pops.toggle("help"),
    isOpen,
    apply: (id: KeyId | null) => set(helpOpenAfter(isOpen(), id)),
  };
}
