import { protectionIntervals } from "../inspector/band";
import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import { control } from "./controls";
import { h } from "./dom";
import { iconSvg } from "./icons";

/**
 * The canvas reminder shown while "Show band" is off and a protection interval is on: protection is still working, only its
 * drawing is hidden (R22-11). Whatever the section fold or the view; Show puts the band back.
 */
export function buildBandPill(stage: HTMLElement, store: Store<AppState>): void {
  const show = control("button", { id: "band-pill-show", type: "button", onclick: () => store.update((s) => ({ ...s, bandVisible: true })) }, "Show");
  const pill = h("div", { id: "band-pill", role: "status", hidden: true }, iconSvg("shield", 14), h("span", { text: "Protection on · band hidden" }), show);
  stage.append(pill);
  const sync = (s: AppState) => {
    pill.hidden = !(s.session && !s.bandVisible && protectionIntervals(s.tools.protection).length > 0);
  };
  store.subscribe(sync);
  sync(store.get());
}
