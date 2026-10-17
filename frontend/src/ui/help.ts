import { KEY_DOCS, MOUSE_DOCS, helpOpenAfter, type KeyId } from "./keys";
import { h } from "./dom";

/** Help overlay filled from the one key table; `apply(id)` is fed every classified key. */
export function buildHelp(root: HTMLElement) {
  let open = false;
  const row = (k: string, v: string) => h("tr", {}, h("td", { class: "k", text: k }), h("td", { text: v }));
  root.append(
    h("strong", { text: "Controls" }),
    h("table", { id: "help-table" }, ...MOUSE_DOCS.map((d) => row(d.keys, d.label)), ...KEY_DOCS.map((d) => row(d.keys, d.label))),
    h("p", { class: "note", text: "Press ? or Esc to close." }),
  );
  const set = (v: boolean) => {
    open = v;
    root.classList.toggle("on", v);
    root.setAttribute("aria-hidden", v ? "false" : "true");
  };
  set(false);
  return {
    toggle: () => set(!open),
    isOpen: () => open,
    apply: (id: KeyId | null) => set(helpOpenAfter(open, id)),
  };
}
