import { type ProtectionEdit, type ProtectionModel, dragPlane } from "../inspector/protection";
import { project } from "../pick/ray";
import { intersectZPlane, screenRay } from "../pick/screenray";
import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import type { Vec3 } from "../state/types";
import { type Depth, rectAxis, rectDepth, rectToBox } from "../tools/box/rect";
import { type DragState, beginDrag, dragBox } from "../tools/box/drag";
import { translateDelta } from "../tools/box/gizmo-math";
import { boxHandles, hitHandle } from "../tools/box/handles";
import { addVertex, moveVertex } from "../tools/polygon/model";

type PlaneKey = { which: "global" | "local"; edge: "min" | "max" };
type Drag =
  | { kind: "box"; state: DragState }
  | { kind: "vertex"; index: number }
  | { kind: "rect"; p0: { x: number; y: number }; depth: Depth }
  | { kind: "plane"; key: PlaneKey; model0: ProtectionModel; anchor: Vec3; ray0: ReturnType<typeof screenRay> };

export interface ToolInteractionDeps {
  onToolChanged: () => void;
  protectionEdit: (fn: (m: ProtectionModel) => ProtectionEdit) => ProtectionEdit;
  notify: (text: string) => void;
  /** True while the hold-R key is down (acts like the Rect toggle). */
  rectHeld?: () => boolean;
}

const PICK_PX = 10;

/** Plane anchors (handles on the protection slab) at the XY centre of the active bounds. */
export function planeAnchors(s: AppState): { key: PlaneKey; anchor: Vec3 }[] {
  const b = s.session?.active_bounds;
  if (!b) return [];
  const cx = (b.min[0] + b.max[0]) / 2;
  const cy = (b.min[1] + b.max[1]) / 2;
  const p = s.tools.protection;
  const out: { key: PlaneKey; anchor: Vec3 }[] = [];
  if (p.global.enabled) {
    out.push({ key: { which: "global", edge: "min" }, anchor: [cx, cy, p.global.min] });
    out.push({ key: { which: "global", edge: "max" }, anchor: [cx, cy, p.global.max] });
  }
  if (p.mode !== "inherit" && p.local) {
    out.push({ key: { which: "local", edge: "min" }, anchor: [cx, cy, p.local.min] });
    out.push({ key: { which: "local", edge: "max" }, anchor: [cx, cy, p.local.max] });
  }
  return out;
}

/** Pointer handling for the editing tools: box handles, polygon drawing and vertex drags, protection planes. */
export function createToolInteraction(
  canvas: HTMLCanvasElement,
  store: Store<AppState>,
  size: () => { w: number; h: number },
  deps: ToolInteractionDeps,
) {
  let drag: Drag | null = null;
  const px = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const zero: Vec3 = [0, 0, 0];

  return {
    pointerDown(e: PointerEvent): boolean {
      const s = store.get();
      if (!s.session || s.compare !== "edited" || e.button !== 0) return false;
      const p = px(e);
      const vp = size();
      const ray = screenRay(s.camera, vp, p.x, p.y);
      if (s.tool === "box" && (s.rect || deps.rectHeld?.())) {
        const axis = rectAxis(s.camera);
        const depth = axis === null ? null : rectDepth(axis, s.session.active_bounds, s.slice);
        if (depth) {
          drag = { kind: "rect", p0: p, depth };
          return true;
        }
        deps.notify("Rectangle select needs an orthographic face view: click a ViewCube face first");
        return false;
      }
      if (s.tool === "box") {
        const hit = hitHandle(boxHandles(s.tools.box, s.camera, s.gizmo.local, vp.h), s.camera, vp, p.x, p.y);
        if (hit) {
          drag = { kind: "box", state: beginDrag(hit, s.tools.box, ray) };
          return true;
        }
      }
      if (s.tool === "polygon" && s.tools.polygon.phase === "closed") {
        const z = s.camera.target[2];
        let best = -1;
        let bd = PICK_PX;
        s.tools.polygon.vertices.forEach((v, i) => {
          const sp = project(s.camera, [v[0], v[1], z], zero, vp);
          const d = sp ? Math.hypot(sp.x - p.x, sp.y - p.y) : Number.POSITIVE_INFINITY;
          if (d <= bd) {
            bd = d;
            best = i;
          }
        });
        if (best >= 0) {
          drag = { kind: "vertex", index: best };
          return true;
        }
      }
      for (const a of planeAnchors(s)) {
        const sp = project(s.camera, a.anchor, zero, vp);
        if (sp && Math.hypot(sp.x - p.x, sp.y - p.y) <= PICK_PX) {
          drag = { kind: "plane", key: a.key, model0: s.tools.protection, anchor: a.anchor, ray0: ray };
          return true;
        }
      }
      return false;
    },

    pointerMove(e: PointerEvent): boolean {
      if (!drag) return false;
      const s = store.get();
      const p = px(e);
      const ray = screenRay(s.camera, size(), p.x, p.y);
      if (drag.kind === "rect") {
        const box = rectToBox(s.tools.box, s.camera, size(), drag.p0, p, drag.depth);
        if (box) {
          store.update((st) => ({ ...st, tools: { ...st.tools, box } }));
          deps.onToolChanged();
        }
      } else if (drag.kind === "box") {
        const box = dragBox(drag.state, ray, {
          symmetric: e.altKey,
          fine: e.shiftKey,
          snap: { on: s.gizmo.snap, step: s.gizmo.step, angleStep: s.gizmo.angleStep },
        });
        store.update((st) => ({ ...st, tools: { ...st.tools, box } }));
        deps.onToolChanged();
      } else if (drag.kind === "vertex") {
        const xy = intersectZPlane(ray, s.camera.target[2]);
        if (!xy) return true;
        const r = moveVertex(s.tools.polygon, drag.index, xy);
        if (r.ok) {
          store.update((st) => ({ ...st, tools: { ...st.tools, polygon: r.state } }));
          deps.onToolChanged();
        } else if (r.message) deps.notify(`${r.message}; the vertex was not moved`);
      } else {
        const d = drag;
        const delta = translateDelta(d.ray0, ray, d.anchor, [0, 0, 1]);
        deps.protectionEdit(() => ({ ok: true, model: dragPlane(d.model0, d.key.which, d.key.edge, delta) }));
      }
      return true;
    },

    pointerUp(): boolean {
      const was = drag !== null;
      drag = null;
      return was;
    },

    /** A click (no drag) while drawing a polygon adds a vertex on the pivot's Z plane. */
    click(e: PointerEvent): boolean {
      const s = store.get();
      if (s.tool !== "polygon" || s.tools.polygon.phase !== "drawing" || s.compare !== "edited") return false;
      const p = px(e);
      const xy = intersectZPlane(screenRay(s.camera, size(), p.x, p.y), s.camera.target[2]);
      if (!xy) return true;
      store.update((st) => ({ ...st, tools: { ...st.tools, polygon: addVertex(st.tools.polygon, xy) } }));
      return true;
    },
    dragging: () => drag !== null,
  };
}
export type ToolInteraction = ReturnType<typeof createToolInteraction>;
