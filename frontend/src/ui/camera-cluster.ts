import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import { togglePerspective } from "../view/camera";
import { fitBounds } from "../view/fit";
import { CLUSTER, CUBE_RIGHT, CUBE_STAGE, CUBE_TOP } from "../view/layout";
import { resetPivot } from "../view/pivot";
import { iconControl } from "./iconbutton";
import { iconSvg } from "./icons";

export interface ClusterActions {
  size: () => { w: number; h: number };
}

const PROJECTION_TIP = {
  persp: "Perspective now; click for orthographic",
  ortho: "Orthographic now; click for perspective",
} as const;

/**
 * The camera cluster under the ViewCube: projection (the icon shows the current one), fit, reset pivot and pick pivot
 * (clicking a point sets the pivot and returns to orbit; Esc cancels). The pivot is set by picking only.
 */
export function buildCameraCluster(root: HTMLElement, store: Store<AppState>, a: ClusterActions): void {
  const persp = iconControl("view-perspective", "persp", {
    onclick: () => store.set({ camera: togglePerspective(store.get().camera) }),
  });
  const fit = iconControl("fit-cloud", "fit", {
    onclick: () => {
      const s = store.get();
      if (!s.session?.active_bounds) return;
      const { w, h } = a.size();
      store.set({ camera: fitBounds(s.camera, s.session.active_bounds, w / Math.max(h, 1)) });
    },
  });
  const reset = iconControl("pivot-reset", "rpiv", {
    onclick: () => {
      const s = store.get();
      store.set({ camera: resetPivot(s.camera, s.session?.active_bounds ?? null) });
    },
  });
  const pick = iconControl("pivot-pick", "ppiv", {
    onclick: () => store.set({ interaction: store.get().interaction === "pick-pivot" ? "orbit" : "pick-pivot" }),
  });
  root.style.right = `${CUBE_RIGHT}px`;
  root.style.top = `${CUBE_TOP + CUBE_STAGE + CLUSTER.gap}px`;
  root.style.width = `${CLUSTER.w}px`;
  root.style.height = `${CLUSTER.h}px`;
  root.style.gap = `${CLUSTER.between}px`;
  root.append(persp, fit, reset, pick);
  const baseTip = persp.title;
  const sync = (s: AppState) => {
    const has = s.session !== null;
    const kind = s.camera.ortho ? "ortho" : "persp";
    if (persp.firstElementChild?.getAttribute("data-icon") !== kind) persp.replaceChildren(iconSvg(kind));
    persp.setAttribute("aria-pressed", String(!s.camera.ortho));
    persp.classList.toggle("active", !s.camera.ortho);
    persp.title = `${baseTip} (${PROJECTION_TIP[kind]})`;
    const picking = s.interaction === "pick-pivot";
    pick.setAttribute("aria-pressed", String(picking));
    pick.classList.toggle("active", picking);
    for (const b of [persp, fit, reset, pick]) b.disabled = !has;
  };
  store.subscribe(sync);
  sync(store.get());
}
