import { axisColours } from "../filterboxes/plane";
import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import { axisTriad } from "../view/cube";
import { BAND, TRIAD } from "../view/layout";

const SVG_NS = "http://www.w3.org/2000/svg";
export const AXIS_COLOUR = { x: "#ff5555", y: "#55ff55", z: "#5599ff" } as const;
/** The light theme's letters (text, so 4.5:1 on the light halo; the lines are the 3:1 axis colours). */
export const LIGHT_TRIAD_LETTER = { x: "#c82f26", y: "#187a2e", z: "#1d67d0" } as const;
const DARK_HALO = "#15181d";
const LIGHT_HALO = "#e9ebef";
const hexOf = (n: number): string => `#${n.toString(16).padStart(6, "0")}`;

/** The small XYZ axis triad (bottom-left of the stage, pointer events off); tracks the camera on every change. */
export function buildTriad(root: HTMLElement, store: Store<AppState>): void {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "cube-triad");
  svg.setAttribute("viewBox", "-28 -28 56 56");
  svg.setAttribute("width", String(TRIAD.size));
  svg.setAttribute("height", String(TRIAD.size));
  svg.setAttribute("aria-hidden", "true");
  const lines = new Map<string, SVGLineElement>();
  const labels = new Map<string, SVGTextElement>();
  for (const axis of ["x", "y", "z"] as const) {
    const l = document.createElementNS(SVG_NS, "line");
    l.setAttribute("stroke-width", "2");
    l.setAttribute("stroke-linecap", "round");
    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("font-size", "10");
    t.setAttribute("font-weight", "700");
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("dominant-baseline", "middle");
    // a halo in the stage colour keeps the letters legible over any cloud colour (painted per theme below)
    t.setAttribute("stroke-width", "2.5");
    t.setAttribute("paint-order", "stroke");
    t.textContent = axis.toUpperCase();
    lines.set(axis, l);
    labels.set(axis, t);
    svg.append(l);
  }
  for (const t of labels.values()) svg.append(t);
  root.style.left = `${TRIAD.left}px`;
  root.style.bottom = `${BAND + TRIAD.above}px`;
  root.style.width = `${TRIAD.size}px`;
  root.style.height = `${TRIAD.size}px`;
  root.append(svg);
  /** Lines, letters and halo in the render theme's colours. */
  const paint = (theme: AppState["renderTheme"]) => {
    const light = theme === "light";
    const axes = axisColours(theme);
    for (const axis of ["x", "y", "z"] as const) {
      lines.get(axis)?.setAttribute("stroke", light ? hexOf(axes[axis]) : AXIS_COLOUR[axis]);
      labels.get(axis)?.setAttribute("fill", light ? LIGHT_TRIAD_LETTER[axis] : AXIS_COLOUR[axis]);
      labels.get(axis)?.setAttribute("stroke", light ? LIGHT_HALO : DARK_HALO);
    }
  };
  let shownTheme = store.get().renderTheme;
  paint(shownTheme);
  let last: AppState["camera"]["orientation"] | null = null;
  const sync = (s: AppState) => {
    if (s.renderTheme !== shownTheme) {
      shownTheme = s.renderTheme;
      paint(shownTheme);
    }
    const o = s.camera.orientation;
    if (last && last.every((v, i) => v === o[i])) return;
    last = [...o];
    for (const t of axisTriad(o)) {
      const l = lines.get(t.axis);
      const tx = labels.get(t.axis);
      l?.setAttribute("x1", "0");
      l?.setAttribute("y1", "0");
      l?.setAttribute("x2", String(t.x * 18));
      l?.setAttribute("y2", String(t.y * 18));
      tx?.setAttribute("x", String(t.x * 23));
      tx?.setAttribute("y", String(t.y * 23));
    }
  };
  store.subscribe(sync);
  sync(store.get());
}
