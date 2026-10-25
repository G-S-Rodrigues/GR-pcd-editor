import { h } from "./dom";
import type { Notice } from "../state/types";
import { iconSvg } from "./icons";


/** One toast (22-8): a glass card with a level icon and the text; a click dismisses it. Errors are alerts, the rest are polite status. */
export function noticeEl(n: Notice, dismiss: (id: number) => void): HTMLElement {
  return h(
    "div",
    { class: `notice ${n.level}`, role: n.level === "error" ? "alert" : "status", title: "Click to dismiss", onclick: () => dismiss(n.id) },
    iconSvg("info", 16),
    h("span", { text: n.text }),
  );
}
