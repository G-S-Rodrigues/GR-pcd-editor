import { VIEWCUBE } from "../colour/palette";
import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import { axisTriad, cubeTransform, hitFace, snapCamera } from "../view/cube";
import { PRESET_ORDER } from "../view/presets";
import { control } from "./controls";
import { h } from "./dom";

const SIDE = 54; // px, cube side
const SVG_NS = "http://www.w3.org/2000/svg";
const AXIS_COLOUR = { x: "#ff5555", y: "#55ff55", z: "#5599ff" } as const;

/** Pure-CSS orthographic ViewCube (no second WebGL context) with a small XYZ triad; tracks the camera on every change. */
export function buildViewCube(root: HTMLElement, store: Store<AppState>): void {
  const stage = h("div", { class: "cube-stage" });
  const faces = new Map<string, HTMLButtonElement>();
  for (const name of PRESET_ORDER) {
    const colours = VIEWCUBE[name];
    const b = control(
      "button",
      {
        id: `cube-${name}`,
        class: "cube-face",
        onclick: (e: MouseEvent) => {
          const r = stage.getBoundingClientRect();
          const x = (e.clientX - (r.left + r.width / 2)) / SIDE;
          const y = (e.clientY - (r.top + r.height / 2)) / SIDE;
          const s = store.get();
          const hit = hitFace(s.camera.orientation, x, y) ?? { faces: [name] };
          store.set({ camera: snapCamera(s.camera, hit) });
        },
      },
      name.toUpperCase(),
    );
    b.style.background = colours.fill;
    b.style.color = colours.text;
    faces.set(name, b);
    stage.append(b);
  }
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "cube-triad");
  svg.setAttribute("viewBox", "-24 -24 48 48");
  const lines = new Map<string, SVGLineElement>();
  const labels = new Map<string, SVGTextElement>();
  for (const axis of ["x", "y", "z"] as const) {
    const l = document.createElementNS(SVG_NS, "line");
    l.setAttribute("stroke", AXIS_COLOUR[axis]);
    l.setAttribute("stroke-width", "2");
    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("fill", AXIS_COLOUR[axis]);
    t.setAttribute("font-size", "9");
    t.setAttribute("font-weight", "700");
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("dominant-baseline", "middle");
    t.textContent = axis.toUpperCase();
    lines.set(axis, l);
    labels.set(axis, t);
    svg.append(l);
  }
  for (const t of labels.values()) svg.append(t);
  root.append(stage, svg);

  let last: AppState["camera"]["orientation"] | null = null;
  const sync = (s: AppState) => {
    const has = s.session !== null;
    for (const b of faces.values()) b.disabled = !has;
    const o = s.camera.orientation;
    if (last && last.every((v, i) => v === o[i])) return;
    last = [...o];
    for (const f of cubeTransform(o)) {
      const b = faces.get(f.face);
      if (!b) continue;
      const [a, bb, c, d, e, g] = f.m;
      b.style.transform = `matrix(${a}, ${bb}, ${c}, ${d}, ${e * SIDE}, ${g * SIDE})`;
      b.style.zIndex = String(Math.round(f.depth * 100) + 100);
      b.style.visibility = f.facing ? "visible" : "hidden";
      b.dataset.facing = String(f.facing);
    }
    for (const t of axisTriad(o)) {
      const l = lines.get(t.axis);
      const tx = labels.get(t.axis);
      l?.setAttribute("x2", String(t.x * 16));
      l?.setAttribute("y2", String(t.y * 16));
      l?.setAttribute("x1", "0");
      l?.setAttribute("y1", "0");
      tx?.setAttribute("x", String(t.x * 21));
      tx?.setAttribute("y", String(t.y * 21));
    }
  };
  store.subscribe(sync);
  sync(store.get());
}
