import { END_ON_DOT, type FilterDrag, beginFilterDrag, moveFilterDrag } from "../filterboxes/drag";
import { ARROW_PX, filterPlanes } from "../filterboxes/plane";
import { type FilterEdit, type Side, sideValue } from "../inspector/filters";
import { type ProtectionEdit, type ProtectionModel, dragPlane, rotateSlab } from "../inspector/protection";
import { RING_EDGE_ON, pivotXY, tiltRings } from "../inspector/rings";
import { normalOf, slabZ } from "../inspector/tilt";
import { dot } from "../math/vec";
import { project } from "../pick/ray";
import { intersectZPlane, screenRay } from "../pick/screenray";
import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import type { Vec3 } from "../state/types";
import { type Depth, narrowBox, rectAxis, rectDepth, rectToBox } from "../tools/box/rect";
import { type DragState, beginDrag, dragBox } from "../tools/box/drag";
import type { BoxModel } from "../tools/box/model";
import { pxPerUnit } from "../view/pointsize";
import { lookDirection } from "../view/camera";
import { ringAngle, rotationDelta, translateDelta } from "../tools/box/gizmo-math";
import { boxHandles, hitHandle } from "../tools/box/handles";
import { addVertex, moveVertex } from "../tools/polygon/model";

type PlaneKey = { which: "global" | "local"; edge: "min" | "max" };
type Drag =
  | { kind: "box"; state: DragState }
  | { kind: "vertex"; index: number }
  | { kind: "rect"; p0: { x: number; y: number }; depth: Depth; narrow: BoxModel | null }
  | { kind: "filter"; d: FilterDrag; key: string; last: number; moved: boolean }
  | { kind: "plane"; key: PlaneKey; model0: ProtectionModel; anchor: Vec3; axis: Vec3; ray0: ReturnType<typeof screenRay> }
  | { kind: "ring"; which: "x" | "y"; model0: ProtectionModel; centre: Vec3; axis: Vec3; a0: number; pivot: [number, number] };

export interface ToolInteractionDeps {
  onToolChanged: () => void;
  protectionEdit: (fn: (m: ProtectionModel) => ProtectionEdit) => ProtectionEdit;
  notify: (text: string) => void;
  /** Sets one display-filter side from an arrow drag (live while dragging, committed on release). */
  filterEdit?: (axis: "x" | "y" | "z", side: Side, value: number, opts: { live: boolean }) => FilterEdit;
  /** True while the hold-R key is down (acts like the Rect toggle). */
  rectHeld?: () => boolean;
}

const PICK_PX = 10;

/** Screen distance from point p to the segment a-b. */
function segDist(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export interface PlaneAnchor {
  key: PlaneKey;
  /** Where the plane's arrow starts: the XY centre of the active bounds at the plane's height. */
  anchor: Vec3;
  /** Arrow tip, pointing away from the band (the lower plane down, the upper one up), ARROW_PX long on screen. */
  tip: Vec3;
  /** The footprint outline of the plane, four corners in order. */
  corners: Vec3[];
}

/** The protection planes' arrows and outlines, at the XY centre and over the footprint of the active bounds. */
export function planeAnchors(s: AppState, viewH = 720): PlaneAnchor[] {
  const b = s.session?.active_bounds;
  if (!b) return [];
  const cx = (b.min[0] + b.max[0]) / 2;
  const cy = (b.min[1] + b.max[1]) / 2;
  const len = ARROW_PX / pxPerUnit(s.camera, Math.max(viewH, 1));
  const p = s.tools.protection;
  const n = normalOf(p.tilt);
  const out: PlaneAnchor[] = [];
  const add = (which: PlaneKey["which"], edge: PlaneKey["edge"], v: number) => {
    const at = (x: number, y: number): Vec3 => [x, y, slabZ(p.tilt, v, x, y)];
    const anchor = at(cx, cy);
    const k = edge === "max" ? len : -len;
    out.push({
      key: { which, edge },
      anchor,
      tip: [anchor[0] + k * n[0], anchor[1] + k * n[1], anchor[2] + k * n[2]],
      corners: [at(b.min[0], b.min[1]), at(b.max[0], b.min[1]), at(b.max[0], b.max[1]), at(b.min[0], b.max[1])],
    });
  };
  if (p.global.enabled) {
    add("global", "min", p.global.min);
    add("global", "max", p.global.max);
  }
  if (p.mode !== "inherit" && p.local) {
    add("local", "min", p.local.min);
    add("local", "max", p.local.max);
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
  const setInteracting = (key: string | null) => store.update((st) => ({ ...st, filterUi: { ...st.filterUi, interacting: key } }));
  const finishFilter = (value: number | null) => {
    if (drag?.kind !== "filter") return;
    const d = drag.d;
    drag = null;
    if (value !== null) deps.filterEdit?.(d.axis, d.side, value, { live: false });
    setInteracting(null);
  };

  return {
    pointerDown(e: PointerEvent): boolean {
      const s = store.get();
      if (!s.session || s.compare !== "edited" || e.button !== 0) return false;
      const p = px(e);
      const vp = size();
      const ray = screenRay(s.camera, vp, p.x, p.y);
      if (deps.filterEdit) {
        // a shown filter plane's arrow wins over everything else; with no plane shown nothing changes
        let best: { key: string; d: FilterDrag; value: number } | null = null;
        let bd = PICK_PX;
        for (const pl of filterPlanes(s, vp.h)) {
          const a = project(s.camera, pl.base, zero, vp);
          const t = project(s.camera, pl.tip, zero, vp);
          if (!a || !t) continue;
          const dist = segDist(p, a, t);
          if (dist > bd) continue;
          const d = beginFilterDrag({ axis: pl.axis, side: pl.side, value: pl.value, ray, origin: pl.centre });
          if (!d) continue;
          bd = dist;
          best = { key: pl.key, d, value: pl.value };
        }
        if (best) {
          drag = { kind: "filter", d: best.d, key: best.key, last: best.value, moved: false };
          setInteracting(best.key);
          return true;
        }
      }
      if (s.tool === "box" && (s.rect || deps.rectHeld?.())) {
        const axis = rectAxis(s.camera);
        const depth = axis === null ? null : rectDepth(axis, s.session.active_bounds, s.slice);
        if (depth) {
          // Shift narrows the box the drag started from; a plain drag replaces it
          drag = { kind: "rect", p0: p, depth, narrow: e.shiftKey ? s.tools.box : null };
          return true;
        }
        deps.notify("Rectangle select needs an orthographic face view: click a ViewCube face first");
        return false;
      }
      if (s.tool === "box") {
        const hit = hitHandle(boxHandles(s.tools.box, s.camera, s.gizmo.local, vp.h, vp.w), s.camera, vp, p.x, p.y);
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
      // the protection band: each plane's arrow or outline; end-on (the look along the slab normal) the drag is disabled
      const normal = normalOf(s.tools.protection.tilt);
      if (Math.abs(dot(lookDirection(s.camera), normal)) <= END_ON_DOT) {
        let best: PlaneAnchor | null = null;
        let bd = PICK_PX;
        for (const a of planeAnchors(s, vp.h)) {
          const base = project(s.camera, a.anchor, zero, vp);
          const tip = project(s.camera, a.tip, zero, vp);
          const q = a.corners.map((c) => project(s.camera, c, zero, vp));
          let d = base && tip ? segDist(p, base, tip) : Number.POSITIVE_INFINITY;
          for (let i = 0; i < 4; i++) {
            const c0 = q[i];
            const c1 = q[(i + 1) % 4];
            if (c0 && c1) d = Math.min(d, segDist(p, c0, c1));
          }
          if (d <= bd) {
            bd = d;
            best = a;
          }
        }
        if (best) {
          drag = { kind: "plane", key: best.key, model0: s.tools.protection, anchor: best.anchor, axis: normal, ray0: ray };
          return true;
        }
      }
      // the rotation rings of the tilted slab (shown only while the protection section is open); arrows and edges win
      {
        const look = lookDirection(s.camera);
        let best: { id: "x" | "y"; centre: Vec3; axis: Vec3 } | null = null;
        let bd = PICK_PX;
        for (const r of tiltRings(s, vp.h)) {
          if (Math.abs(dot(look, r.axis)) < RING_EDGE_ON) continue;
          const q = r.pts.map((pt) => project(s.camera, pt, zero, vp));
          for (let i = 0; i < q.length; i++) {
            const c0 = q[i];
            const c1 = q[(i + 1) % q.length];
            if (!c0 || !c1) continue;
            const d = segDist(p, c0, c1);
            if (d <= bd) {
              bd = d;
              best = r;
            }
          }
        }
        if (best) {
          const a0 = ringAngle(ray, best.centre, best.axis);
          const pv = pivotXY(s);
          if (a0 !== null && pv) {
            drag = { kind: "ring", which: best.id, model0: s.tools.protection, centre: best.centre, axis: best.axis, a0, pivot: pv };
            return true;
          }
        }
      }
      return false;
    },

    pointerMove(e: PointerEvent): boolean {
      if (!drag) return false;
      const s = store.get();
      const p = px(e);
      const ray = screenRay(s.camera, size(), p.x, p.y);
      if (drag.kind === "filter") {
        const b = s.session?.bounds;
        const d = drag.d;
        if (!b) return true;
        const other = sideValue(s.tools.filters, b, d.axis, d.side === "min" ? "max" : "min");
        const v = moveFilterDrag(d, ray, b, other, e.shiftKey);
        if (v === null) return true;
        drag.last = v;
        drag.moved = true;
        deps.filterEdit?.(d.axis, d.side, v, { live: true });
      } else if (drag.kind === "rect") {
        const box = drag.narrow ? narrowBox(drag.narrow, s.camera, size(), drag.p0, p) : rectToBox(s.tools.box, s.camera, size(), drag.p0, p, drag.depth);
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
      } else if (drag.kind === "plane") {
        const d = drag;
        const delta = translateDelta(d.ray0, ray, d.anchor, d.axis);
        deps.protectionEdit(() => ({ ok: true, model: dragPlane(d.model0, d.key.which, d.key.edge, delta) }));
      } else if (drag.kind === "ring") {
        const d = drag;
        const a = ringAngle(ray, d.centre, d.axis);
        if (a === null) return true;
        const deg = (rotationDelta(d.a0, a) * 180) / Math.PI;
        deps.protectionEdit(() => ({ ok: true, model: rotateSlab(d.model0, d.which, deg, d.pivot) }));
      }
      return true;
    },

    pointerUp(): boolean {
      const was = drag !== null;
      if (drag?.kind === "filter") finishFilter(drag.moved ? drag.last : null);
      drag = null;
      return was;
    },

    /** Esc during a filter or protection arrow drag: restore the start value and stop. Returns whether a drag was cancelled. */
    cancel(): boolean {
      if (drag?.kind === "plane" || drag?.kind === "ring") {
        const m = drag.model0;
        drag = null;
        deps.protectionEdit(() => ({ ok: true, model: m }));
        return true;
      }
      if (drag?.kind !== "filter") return false;
      finishFilter(drag.d.start);
      return true;
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
