import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import { control } from "./controls";
import { h } from "./dom";
import type { ThemeChoice } from "./themechoice";
import { type DisplayActions, buildDisplayControls } from "./viewbar";

export interface DisplayPopoverActions extends DisplayActions {
  /** The choice in force when the popover is built. */
  theme: ThemeChoice;
  setTheme: (c: ThemeChoice) => void;
}

const THEMES: [ThemeChoice, string][] = [["system", "System"], ["light", "Light"], ["dark", "Dark"]];

/** The Display popover body: the view controls and the theme choice. */
export function buildDisplayPopover(root: HTMLElement, store: Store<AppState>, a: DisplayPopoverActions): void {
  root.append(h("h4", { text: "Display" }));
  buildDisplayControls(root, store, a);
  const buttons = THEMES.map(([c, label]) =>
    control("button", { id: `theme-${c}`, type: "button", "aria-pressed": String(c === a.theme), onclick: () => {
      for (const [k, b] of buttons) b.setAttribute("aria-pressed", String(k === c));
      a.setTheme(c);
    } }, label),
  ).map((b, i) => [THEMES[i][0], b] as const);
  const group = h("div", { class: "seg", role: "group", "aria-label": "Theme" }, ...buttons.map(([, b]) => b));
  root.append(h("div", { class: "prow" }, h("span", { class: "plabel", text: "Theme" }), h("div", { class: "pctl" }, group)));
}
