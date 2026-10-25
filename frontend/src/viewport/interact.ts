import { END_ON_DOT, type FilterDrag, beginFilterDrag, moveFilterDrag } from "../filterboxes/drag";
import { filterPlanes } from "../filterboxes/plane";
import { type FilterEdit, type Side, sideValue } from "../inspector/filters";
import { type PlaneKey, planeAnchors } from "../inspector/band";
import { type BandArrow, type BandRing, bandGizmo } from "../inspector/bandgizmo";
import { type ProtectionEdit, type ProtectionModel, dragPlane, rotateSlab } from "../inspector/protection";
import { pivotXY } from "../inspector/rings";
import { normalOf } from "../inspector/tilt";
import { dot } from "../math/vec";
import { pickPoint, project } from "../pick/ray";
import { toWorld } from "../render/origin";
import { intersectZPlane, screenRay } from "../pick/screenray";
import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import type { Vec3 } from "../state/types";
import { type Depth, narrowBox, rectAxis, rectDepth, rectToBox } from "../tools/box/rect";
import { type DragState, advanceRing, beginDrag, dragBox } from "../tools/box/drag";
import type { BoxModel } from "../tools/box/model";
import { pxPerUnit } from "../view/pointsize";
import { lookDirection } from "../view/camera";
import { segDist } from "../math/seg2d";
import { type TurnState, ringAngle, translateDelta } from "../tools/box/gizmo-math";
import { moveOnPlane, rayBoxHit } from "../tools/box/body";
import { type Handle, RING_DEADZONE_PX, boxHandles, hitHandle } from "../tools/box/handles";
import { addVertex, insertVertex, moveVertex, removeVertex } from "../tools/polygon/model";
import type { Vec2 } from "../tools/polygon/validate";

type Drag =
  | { kind: "box"; state: DragState }
  | { kind: "body"; box0: BoxModel; grab: Vec3; x0: number; y0: number; moved: boolean }
  | { kind: "vertex"; index: number; moved: boolean; t: number }
  | { kind: "rect"; p0: { x: number; y: number }; depth: Depth; narrow: BoxModel | null }
  | { kind: "filter"; d: FilterDrag; key: string; last: number; moved: boolean }
  | { kind: "plane"; key: PlaneKey; model0: ProtectionModel; anchor: Vec3; axis: Vec3; ray0: ReturnType<typeof screenRay> }
  | { kind: "ring"; which: "x" | "y"; model0: ProtectionModel; centre: Vec3; axis: Vec3; turn: TurnState | null; deadzone: number; pivot: [number, number] };

/** The band geometry lives in inspector/band.ts; re-exported so the viewport tests keep their import. */
export { planeAnchors };

export interface ToolInteractionDeps {
  onToolChanged: () => void;
  protectionEdit: (fn: (m: ProtectionModel) => ProtectionEdit) => ProtectionEdit;
  notify: (text: string) => void;
  /** Sets one display-filter side from an arrow drag (live while dragging, committed on release). */
  filterEdit?: (axis: "x" | "y" | "z", side: Side, value: number, opts: { live: boolean }) => FilterEdit;
  /** True while the hold-R key is down (acts like the Rect toggle). */
  rectHeld?: () => boolean;
  /** An informational (not warning) notice, shown once by the first body drag. */
  hint?: (text: string) => void;
}

/** Cursor and handle id under the pointer (the box gizmo): the same hit tests a press uses. */
export interface BoxHover {
  cursor: "move" | "grab" | "ew-resize" | "ns-resize" | "nesw-resize" | "nwse-resize";
  /** The hovered arrow or ring id; null over the body. */
  id: string | null;
}

/** A press that moves less than this many pixels is a click, not a drag (shared with the camera controls). */
export const CLICK_SLOP_PX = 4;
export const BODY_HINT = "Dragging the box moves it. Ctrl+drag, or start outside the box, to orbit.";

const PICK_PX = 10;
/** Two presses on the same polygon vertex within this many ms (edit mode) remove it. */
const DOUBLE_TAP_MS = 400;

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
  let hovered: number | null = null;
  let lastTap: { index: number; t: number } | null = null;
  /** The polygon vertex within the pick radius of screen point p (nearest wins), or -1. */
  const vertexAt = (s: AppState, vp: { w: number; h: number }, p: { x: number; y: number }): number => {
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
    return best;
  };
  /** The polygon edge within the pick radius of p, with the point on it (a convex mix of its two vertices), or null. */
  const edgeAt = (s: AppState, vp: { w: number; h: number }, p: { x: number; y: number }): { edge: number; at: Vec2 } | null => {
    const z = s.camera.target[2];
    const v = s.tools.polygon.vertices;
    let best: { edge: number; at: Vec2 } | null = null;
    let bd = PICK_PX;
    for (let i = 0; i < v.length; i++) {
      const j = (i + 1) % v.length;
      const a = project(s.camera, [v[i][0], v[i][1], z], zero, vp);
      const b = project(s.camera, [v[j][0], v[j][1], z], zero, vp);
      if (!a || !b) continue;
      const d = segDist(p, a, b);
      if (d > bd) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
      bd = d;
      best = { edge: i, at: [v[i][0] + t * (v[j][0] - v[i][0]), v[i][1] + t * (v[j][1] - v[i][1])] };
    }
    return best;
  };
  const removeAt = (index: number): boolean => {
    const r = removeVertex(store.get().tools.polygon, index);
    hovered = null;
    if (!r.ok) {
      if (r.message) deps.notify(`${r.message}; the vertex was not removed`);
      return false;
    }
    store.update((st) => ({ ...st, tools: { ...st.tools, polygon: r.state } }));
    deps.onToolChanged();
    return true;
  };
  const setInteracting = (key: string | null) => store.update((st) => ({ ...st, filterUi: { ...st.filterUi, interacting: key } }));
  const finishFilter = (value: number | null) => {
    if (drag?.kind !== "filter") return;
    const d = drag.d;
    drag = null;
    if (value !== null) deps.filterEdit?.(d.axis, d.side, value, { live: false });
    setInteracting(null);
  };

  /**
   * The band's handle under p (22-3): a tilt ring or a z arrow tip, picked like the Box's (rings first, then tips), else a protection
   * plane's outline (not end-on). Null when nothing is there, and always null while "Show band" is off.
   */
  const bandHit = (
    s: AppState,
    vp: { w: number; h: number },
    p: { x: number; y: number },
  ): { kind: "arrow"; arrow: BandArrow } | { kind: "ring"; ring: BandRing } | { kind: "outline"; arrow: BandArrow } | null => {
    const g = bandGizmo(s, vp.h);
    if (g.handles.length === 0) return null;
    const h = hitHandle(g.handles, s.camera, vp, p.x, p.y);
    if (h) {
      const ring = g.rings.find((r) => r.id === h.id);
      if (ring) return { kind: "ring", ring };
      const arrow = g.arrows.find((a) => a.id === h.id);
      if (arrow) return { kind: "arrow", arrow };
    }
    if (Math.abs(dot(lookDirection(s.camera), normalOf(s.tools.protection.tilt))) > END_ON_DOT) return null;
    let best: BandArrow | null = null;
    let bd = PICK_PX;
    for (const a of g.arrows) {
      const q = a.plane.corners.map((c) => project(s.camera, c, zero, vp));
      for (let i = 0; i < 4; i++) {
        const c0 = q[i];
        const c1 = q[(i + 1) % 4];
        if (!c0 || !c1) continue;
        const d = segDist(p, c0, c1);
        if (d <= bd) {
          bd = d;
          best = a;
        }
      }
    }
    return best ? { kind: "outline", arrow: best } : null;
  };
  /** The box handle (arrow tip or ring) under p with the Box tool armed, or null. */
  const boxHandleAt = (s: AppState, vp: { w: number; h: number }, p: { x: number; y: number }, e: { ctrlKey?: boolean; metaKey?: boolean }): Handle | null =>
    s.tool === "box" && !e.ctrlKey && !e.metaKey ? hitHandle(boxHandles(s.tools.box, s.camera, vp.h), s.camera, vp, p.x, p.y) : null; // Ctrl/Meta over a handle orbits
  /** Where the pointer ray enters the box body, when a plain left press there should move the box; null otherwise. */
  const bodyHit = (s: AppState, ray: ReturnType<typeof screenRay>, e: { shiftKey: boolean; ctrlKey?: boolean; metaKey?: boolean }) => {
    if (s.tool !== "box" || s.interaction !== "orbit" || e.shiftKey || e.ctrlKey || e.metaKey) return null; // Shift pans, Ctrl always orbits
    return rayBoxHit(ray, s.tools.box, s.camera.ortho);
  };
  /** The cursor class for the box gizmo at a pointer position, from the same hit tests a press uses; null when nothing there. */
  const hoverAt = (s: AppState, vp: { w: number; h: number }, p: { x: number; y: number }, e: PointerEvent): BoxHover | null => {
    if (s.tool !== "box" || !s.session || s.compare !== "edited" || s.rect || deps.rectHeld?.()) return null;
    const hit = boxHandleAt(s, vp, p, e);
    if (hit) {
      if (hit.cls === "rotate") return { cursor: "grab", id: hit.id };
      const a = project(s.camera, hit.base ?? s.tools.box.center, zero, vp);
      const b = project(s.camera, hit.anchor, zero, vp);
      if (!a || !b) return { cursor: "ew-resize", id: hit.id };
      const deg = ((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 180) % 180; // an arrow line has no sign
      const cursor = deg < 22.5 || deg >= 157.5 ? "ew-resize" : deg < 67.5 ? "nwse-resize" : deg < 112.5 ? "ns-resize" : "nesw-resize";
      return { cursor, id: hit.id };
    }
    if (bandHit(s, vp, p)) return null;
    const ray = screenRay(s.camera, vp, p.x, p.y);
    return bodyHit(s, ray, e) ? { cursor: "move", id: null } : null;
  };
  let hintShown = false;
  let unmovedBody = false;

  return {
    pointerDown(e: PointerEvent): boolean {
      unmovedBody = false;
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
        const depth = axis === null ? null : rectDepth(axis, s.session.active_bounds);
        if (depth) {
          // Shift narrows the box the drag started from; a plain drag replaces it
          drag = { kind: "rect", p0: p, depth, narrow: e.shiftKey ? s.tools.box : null };
          return true;
        }
        deps.notify("Rectangle select needs an orthographic face view: click a ViewCube face first");
        return false;
      }
      const hit = boxHandleAt(s, vp, p, e);
      if (hit) {
        drag = { kind: "box", state: beginDrag(hit, s.tools.box, ray, RING_DEADZONE_PX / pxPerUnit(s.camera, Math.max(vp.h, 1)), s.camera.ortho) };
        return true;
      }
      if (s.tool === "polygon" && s.tools.polygon.phase === "closed") {
        const best = vertexAt(s, vp, p);
        if (best >= 0) {
          const tap = lastTap;
          lastTap = null;
          if (s.tools.polygon.editing && tap && tap.index === best && e.timeStamp - tap.t <= DOUBLE_TAP_MS) {
            removeAt(best); // a second quick tap on the same vertex in edit mode removes it
            return true;
          }
          drag = { kind: "vertex", index: best, moved: false, t: e.timeStamp };
          return true;
        }
      }
      // a waiting pick (seed, pivot, floor) owns the press: a point near the band's outline is picked, not dragged along (E2E-87)
      const band = s.interaction === "orbit" ? bandHit(s, vp, p) : null;
      if (band && band.kind !== "ring") {
        const pl = band.arrow.plane;
        drag = { kind: "plane", key: band.arrow.key, model0: s.tools.protection, anchor: pl.anchor, axis: normalOf(s.tools.protection.tilt), ray0: ray };
        return true;
      }
      if (band) {
        const h = band.ring.handle;
        const a0 = ringAngle(ray, h.centre!, h.dir, s.camera.ortho);
        const pv = pivotXY(s);
        if (a0 !== null && pv) {
          const deadzone = RING_DEADZONE_PX / pxPerUnit(s.camera, Math.max(vp.h, 1));
          drag = { kind: "ring", which: band.ring.which, model0: s.tools.protection, centre: h.centre!, axis: h.dir, turn: { prev: a0, total: 0 }, deadzone, pivot: pv };
          return true;
        }
      }
      // the box body is last, so every arrow, ring, protection and filter control over the box still wins
      const body = bodyHit(s, ray, e);
      if (body) {
        drag = { kind: "body", box0: s.tools.box, grab: body.point, x0: e.clientX, y0: e.clientY, moved: false };
        return true;
      }
      return false;
    },

    pointerMove(e: PointerEvent): boolean {
      if (!drag) {
        // edit mode: remember the vertex under the pointer, for the Backspace key
        const s = store.get();
        hovered = s.tool === "polygon" && s.tools.polygon.phase === "closed" && s.tools.polygon.editing ? vertexAt(s, size(), px(e)) : -1;
        if (hovered < 0) hovered = null;
        return false;
      }
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
      } else if (drag.kind === "body") {
        if (!drag.moved) {
          if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) <= CLICK_SLOP_PX) return true; // still a possible click
          drag.moved = true;
          if (!hintShown) {
            hintShown = true;
            deps.hint?.(BODY_HINT);
          }
        }
        const box = moveOnPlane(drag.box0, drag.grab, ray, lookDirection(s.camera), { on: s.gizmo.snap, step: s.gizmo.step });
        store.update((st) => ({ ...st, tools: { ...st.tools, box } }));
        deps.onToolChanged();
      } else if (drag.kind === "vertex") {
        const xy = intersectZPlane(ray, s.camera.target[2]);
        if (!xy) return true;
        drag.moved = true;
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
        d.turn = advanceRing(d.turn, ray, d.centre, d.axis, d.deadzone, s.camera.ortho);
        if (!d.turn) return true;
        const deg = (d.turn.total * 180) / Math.PI;
        deps.protectionEdit(() => ({ ok: true, model: rotateSlab(d.model0, d.which, deg, d.pivot) }));
      }
      return true;
    },

    pointerUp(): boolean {
      const was = drag !== null;
      // a body press that never moved is a click: the camera controls pass it on to click() (box click-to-centre)
      if (drag?.kind === "body" && !drag.moved) {
        drag = null;
        unmovedBody = true;
        return false;
      }
      if (drag?.kind === "filter") finishFilter(drag.moved ? drag.last : null);
      // an untouched press on a vertex is the first tap of a possible double tap (edit mode removes the vertex)
      lastTap = drag?.kind === "vertex" && !drag.moved ? { index: drag.index, t: drag.t } : null;
      drag = null;
      return was;
    },

    /** Esc during a filter, protection, box arrow, ring or body drag: restore the start value (the box from before the drag) and stop. Returns whether a drag was cancelled. */
    cancel(): boolean {
      if (drag?.kind === "box" || drag?.kind === "body") {
        const d = drag;
        const box = d.kind === "box" ? d.state.box0 : d.box0;
        const changed = d.kind === "box" || d.moved;
        drag = null;
        if (changed) {
          store.update((st) => ({ ...st, tools: { ...st.tools, box } }));
          deps.onToolChanged();
        }
        return true;
      }
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

    /**
     * A click (no drag). While drawing a polygon it adds a vertex on the pivot's Z plane. With the Box tool armed (and no
     * pick mode, no modifier key) it moves the box centre to the clicked cloud point, else to where the ray meets the
     * horizontal plane through the current centre.
     */
    click(e: PointerEvent): boolean {
      const s = store.get();
      if (s.tool === "box" && s.interaction === "orbit" && s.compare === "edited" && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        const p = px(e);
        const c0 = s.tools.box.center;
        let centre: Vec3 | null = null;
        const hit = s.render ? pickPoint(s.render, s.camera, size(), p.x, p.y, 8) : null;
        if (s.render && hit) {
          const r = s.render;
          centre = toWorld([r.coords[3 * hit.index], r.coords[3 * hit.index + 1], r.coords[3 * hit.index + 2]], r.origin);
        } else {
          const xy = intersectZPlane(screenRay(s.camera, size(), p.x, p.y), c0[2]);
          if (xy) centre = [xy[0], xy[1], c0[2]];
        }
        if (!centre) return true;
        const c = centre;
        store.update((st) => ({ ...st, tools: { ...st.tools, box: { ...st.tools.box, center: c } } }));
        deps.onToolChanged();
        return true;
      }
      if (s.tool === "polygon" && s.tools.polygon.phase === "closed" && s.tools.polygon.editing && s.compare === "edited" && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        // edit mode: a click on an edge adds a vertex there (a press on a vertex was already a drag)
        const hit = edgeAt(s, size(), px(e));
        if (!hit) return false;
        const r = insertVertex(s.tools.polygon, hit.edge, hit.at);
        if (!r.ok) {
          if (r.message) deps.notify(`${r.message}; the vertex was not added`);
          return true;
        }
        store.update((st) => ({ ...st, tools: { ...st.tools, polygon: r.state } }));
        deps.onToolChanged();
        return true;
      }
      if (s.tool !== "polygon" || s.tools.polygon.phase !== "drawing" || s.compare !== "edited") return false;
      const p = px(e);
      const xy = intersectZPlane(screenRay(s.camera, size(), p.x, p.y), s.camera.target[2]);
      if (!xy) return true;
      store.update((st) => ({ ...st, tools: { ...st.tools, polygon: addVertex(st.tools.polygon, xy) } }));
      return true;
    },
    dragging: () => drag !== null,
    /** True once after a pointerUp that ended an unmoved press on the box body: the caller then treats it as a click. */
    /** Tells the app the Box tool state changed outside a drag (a keyboard edit): preview, overlay and fields follow. */
    changed(): void {
      deps.onToolChanged();
    },
    takeClick(): boolean {
      const v = unmovedBody;
      unmovedBody = false;
      return v;
    },
    /** The cursor class and handle id under the pointer for the Box tool (null elsewhere); not while a drag is under way. */
    hover(e: PointerEvent): BoxHover | null {
      if (drag) return null;
      return hoverAt(store.get(), size(), px(e), e);
    },
    /** The polygon vertex under the pointer in edit mode, or null. */
    hoveredVertex: (): number | null => hovered,
    /** Backspace in edit mode: removes the hovered vertex; false when none is hovered or the removal is refused (a notice says why). */
    removeHovered(): boolean {
      const s = store.get();
      if (hovered === null || s.tool !== "polygon" || s.tools.polygon.phase !== "closed" || !s.tools.polygon.editing) return false;
      return removeAt(hovered);
    },
  };
}
export type ToolInteraction = ReturnType<typeof createToolInteraction>;
