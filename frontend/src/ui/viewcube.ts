import { VIEWCUBE } from "../colour/palette";
import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import { cubeTransform, hitFace, snapCamera } from "../view/cube";
import { CORNER_IDS, arrowLayout, cornerZones } from "../view/cubenav";
import { CUBE_NAV, CUBE_SIDE, CUBE_WRAP } from "../view/layout";
import { PRESET_ORDER, applyPreset } from "../view/presets";
import { ARROW_STYLE, installCubeNavStyle } from "./cube-arrows";
import { control } from "./controls";
import { h } from "./dom";
import { iconSvg } from "./icons";
import { describeControls } from "./describe";

const LABELS = new Map(describeControls().map((d) => [d.id, d.label]));
const C = CUBE_WRAP / 2;

/**
 * Pure-CSS orthographic ViewCube (no second WebGL context) with six outward arrows (one per face, reaching faces hidden
 * behind the cube) and corner zones just outside the silhouette; tracks the camera on every change.
 */
export function buildViewCube(root: HTMLElement, store: Store<AppState>): void {
  installCubeNavStyle();
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
          const x = (e.clientX - (r.left + r.width / 2)) / CUBE_SIDE;
          const y = (e.clientY - (r.top + r.height / 2)) / CUBE_SIDE;
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
  const arrows = new Map<string, HTMLButtonElement>();
  const glyphs = new Map<string, SVGSVGElement>();
  for (const name of PRESET_ORDER) {
    const svg = iconSvg(ARROW_STYLE.icon, ARROW_STYLE.glyphSize);
    glyphs.set(name, svg);
    arrows.set(
      name,
      control(
        "button",
        {
          id: `arrow-${name}`,
          type: "button",
          class: "cube-arrow",
          "aria-label": LABELS.get(`arrow-${name}`),
          onclick: () => store.set({ camera: applyPreset(store.get().camera, name) }),
        },
        svg,
      ),
    );
  }
  const zones = new Map<string, HTMLButtonElement>();
  for (const id of CORNER_IDS) {
    zones.set(
      id,
      control("button", {
        id,
        type: "button",
        class: "cube-corner",
        "aria-label": LABELS.get(id),
        onclick: () => {
          const s = store.get();
          store.set({ camera: snapCamera(s.camera, { faces: cornerFacesOf(id) }) });
        },
      }),
    );
  }
  root.append(stage, ...arrows.values(), ...zones.values());

  let last: AppState["camera"]["orientation"] | null = null;
  const sync = (s: AppState) => {
    const has = s.session !== null;
    for (const b of [...faces.values(), ...arrows.values(), ...zones.values()]) b.disabled = !has;
    const o = s.camera.orientation;
    if (last && last.every((v, i) => v === o[i])) return;
    last = [...o];
    for (const f of cubeTransform(o)) {
      const b = faces.get(f.face);
      if (!b) continue;
      const [a, bb, c, d, e, g] = f.m;
      b.style.transform = `matrix(${a}, ${bb}, ${c}, ${d}, ${e * CUBE_SIDE}, ${g * CUBE_SIDE})`;
      b.style.zIndex = String(Math.round(f.depth * 100) + 100);
      b.style.visibility = f.facing ? "visible" : "hidden";
      b.dataset.facing = String(f.facing);
    }
    for (const a of arrowLayout(o)) {
      const b = arrows.get(a.face);
      if (!b) continue;
      b.style.left = `${C + a.x - CUBE_NAV.arrow / 2}px`;
      b.style.top = `${C + a.y - CUBE_NAV.arrow / 2}px`;
      const g = glyphs.get(a.face);
      if (g) g.style.transform = `rotate(${a.angle}deg)`;
      b.dataset.slot = String(a.slot);
    }
    const shown = new Map(cornerZones(o).map((z) => [z.id, z]));
    for (const [id, b] of zones) {
      const z = shown.get(id);
      b.hidden = !z;
      if (!z) continue;
      b.style.left = `${C + z.x - CUBE_NAV.zone / 2}px`;
      b.style.top = `${C + z.y - CUBE_NAV.zone / 2}px`;
    }
  };
  store.subscribe(sync);
  sync(store.get());
}

/** The three faces of a corner id (`corner-top-front-left`). */
function cornerFacesOf(id: string): ("top" | "bottom" | "front" | "back" | "left" | "right")[] {
  return id.slice(7).split("-") as ("top" | "bottom" | "front" | "back" | "left" | "right")[];
}
