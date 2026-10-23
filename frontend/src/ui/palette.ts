import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import { ARM_PILL, PALETTE } from "../view/layout";
import { h } from "./dom";
import { iconControl } from "./iconbutton";
import type { IconName } from "./icons";
import { TOOLTIPS } from "./tooltips";

type Tool = Exclude<AppState["tool"], "none">;

/** The six tools in palette order: the control id, the tool, the icon and the name the arm pill shows. */
export const PALETTE_TOOLS: readonly { id: string; tool: Tool; icon: IconName; name: string }[] = [
  { id: "tool-box", tool: "box", icon: "box", name: "Box" },
  { id: "tool-polygon", tool: "polygon", icon: "poly", name: "Polygon" },
  { id: "tool-cluster", tool: "cluster", icon: "cluster", name: "Cluster" },
  { id: "tool-sparse", tool: "sparse", icon: "sparse", name: "Sparse points" },
  { id: "tool-plane", tool: "plane", icon: "plane", name: "Planes" },
  { id: "tool-thin", tool: "thin", icon: "thin", name: "Thin" },
];

/**
 * The floating tool palette: six icon buttons (the ids the left panel used to hold) and the arm pill that names the armed tool
 * and says how to leave it. A click arms, a second click on the armed button disarms.
 */
export function buildPalette(root: HTMLElement, store: Store<AppState>, a: { setTool: (t: AppState["tool"]) => void }, pill?: HTMLElement): void {
  const btns = PALETTE_TOOLS.map((t) =>
    iconControl(t.id, t.icon, { class: "tb", "aria-pressed": "false", onclick: () => a.setTool(store.get().tool === t.tool ? "none" : t.tool) }),
  );
  root.style.left = `${PALETTE.left}px`;
  root.style.top = `${PALETTE.top}px`;
  if (pill) {
    pill.style.left = `${ARM_PILL.left}px`;
    pill.style.top = `${ARM_PILL.top}px`;
    pill.style.height = `${ARM_PILL.h}px`;
    pill.style.maxWidth = `${ARM_PILL.maxW}px`;
  }
  root.append(...btns);
  const sync = (s: AppState) => {
    const open = s.session !== null;
    const ro = s.compare !== "edited";
    PALETTE_TOOLS.forEach((t, i) => {
      btns[i].classList.toggle("active", s.tool === t.tool);
      btns[i].setAttribute("aria-pressed", String(s.tool === t.tool));
      btns[i].disabled = !open || ro;
      btns[i].title = `${TOOLTIPS[t.id]}${ro ? " (disabled: return to the edited view to edit)" : ""}`;
    });
    if (!pill) return;
    const armed = PALETTE_TOOLS.find((t) => t.tool === s.tool);
    pill.hidden = !armed;
    pill.replaceChildren(...(armed ? [h("span", { text: `${armed.name} · ` }), h("kbd", { text: "Esc" }), h("span", { text: " to exit" })] : []));
  };
  store.subscribe(sync);
  sync(store.get());
}
