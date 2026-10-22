import { filterPlanes } from "../filterboxes/plane";
import { bandGizmo } from "../inspector/bandgizmo";
import { project } from "../pick/ray";
import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import type { Vec3 } from "../state/types";
import { rayBoxHit } from "../tools/box/body";
import { boxHandles, hitHandle } from "../tools/box/handles";
import { screenRay } from "../pick/screenray";

/**
 * Read-only hook for the browser smoke (`window.__editor`): the app state and the page position of every
 * box handle, so a real mouse can grab one. It changes nothing.
 */
export function installDebugHook(canvas: HTMLCanvasElement, store: Store<AppState>, size: () => { w: number; h: number }, drawnCount: () => number = () => 0, stepLayer: () => unknown = () => ({ visible: false }), previewLayer: () => unknown = () => ({ id: null, add: 0, remove: 0 })): void {
  const hook = {
    state: () => store.get(),
    /** Points the main layer draws right now (lower while the camera moves). */
    drawnCount,
    /** The history-step highlight layer as drawn: sid, visible, count, colour (0..1), opacity, hover. */
    stepLayer,
    /** Drawn points flagged will-be-added / will-be-removed by a pending preview. */
    previewLayer,
    /** Page position (px) of a file-frame world point under the current camera; null if it is behind the eye. */
    projectWorld: (p: Vec3): { x: number; y: number } | null => {
      const s = store.get();
      const r = canvas.getBoundingClientRect();
      const q = project(s.camera, p, [0, 0, 0], size());
      return q ? { x: r.left + q.x, y: r.top + q.y } : null;
    },
    handlePositions: (): { id: string; x: number; y: number }[] => {
      const s = store.get();
      const r = canvas.getBoundingClientRect();
      const zero: Vec3 = [0, 0, 0];
      return boxHandles(s.tools.box, s.camera, size().h).flatMap((h) => {
        const p = project(s.camera, h.anchor, zero, size());
        return p ? [{ id: h.id, x: r.left + p.x, y: r.top + p.y }] : [];
      });
    },
    /** Read-only: each box rotation ring's centre (world and page px) and its projected outline samples (page px). */
    boxRings: (): { id: string; centreWorld: Vec3; centre: { x: number; y: number } | null; pts: { x: number; y: number }[] }[] => {
      const s = store.get();
      const r = canvas.getBoundingClientRect();
      const vp = size();
      const page = (p: Vec3) => {
        const q = project(s.camera, p, [0, 0, 0], vp);
        return q ? { x: r.left + q.x, y: r.top + q.y } : null;
      };
      return boxHandles(s.tools.box, s.camera, vp.h)
        .filter((h) => h.cls === "rotate" && h.centre)
        .map((h) => ({ id: h.id, centreWorld: h.centre as Vec3, centre: page(h.centre as Vec3), pts: (h.ring ?? []).flatMap((p) => page(p) ?? []) }));
    },
    /**
     * Page position (px) of a spot on the box body that a plain press would grab: the ray enters the box there, no arrow
     * or ring is within reach and the canvas (not an overlay) is on top. The one farthest from every handle; null if none.
     */
    boxBodyPoint: (): { x: number; y: number } | null => {
      const s = store.get();
      const r = canvas.getBoundingClientRect();
      const vp = size();
      const hs = boxHandles(s.tools.box, s.camera, vp.h);
      let best: { x: number; y: number; d: number } | null = null;
      for (let i = 1; i < 40; i++) {
        for (let j = 1; j < 40; j++) {
          const x = (i / 40) * vp.w;
          const y = (j / 40) * vp.h;
          if (!rayBoxHit(screenRay(s.camera, vp, x, y), s.tools.box, s.camera.ortho)) continue;
          if (hitHandle(hs, s.camera, vp, x, y)) continue;
          if (document.elementFromPoint(r.left + x, r.top + y) !== canvas) continue;
          let d = Number.POSITIVE_INFINITY;
          for (const h of hs) {
            for (const q of h.ring ?? [h.anchor]) {
              const p = project(s.camera, q, [0, 0, 0], vp);
              if (p) d = Math.min(d, Math.hypot(p.x - x, p.y - y));
            }
          }
          if (!best || d > best.d) best = { x, y, d };
        }
      }
      return best ? { x: r.left + best.x, y: r.top + best.y } : null;
    },
    /** Page position (px) of each shown filter plane's arrow base and tip, so a real mouse can grab the arrow. */
    filterPlanes: (): { key: string; base: { x: number; y: number } | null; tip: { x: number; y: number } | null }[] => {
      const s = store.get();
      const r = canvas.getBoundingClientRect();
      const at = (p: Vec3) => {
        const q = project(s.camera, p, [0, 0, 0], size());
        return q ? { x: r.left + q.x, y: r.top + q.y } : null;
      };
      return filterPlanes(s, size().h).map((p) => ({ key: p.key, base: at(p.base), tip: at(p.tip) }));
    },
    /** Page positions of the protection planes' arrow bases and tips, so a real mouse can grab an arrow. */
    protectionArrows: (): { key: string; base: { x: number; y: number } | null; tip: { x: number; y: number } | null }[] => {
      const s = store.get();
      const r = canvas.getBoundingClientRect();
      const at = (p: Vec3) => {
        const q = project(s.camera, p, [0, 0, 0], size());
        return q ? { x: r.left + q.x, y: r.top + q.y } : null;
      };
      return bandGizmo(s, size().h).arrows.map((a) => ({ key: `${a.key.which}-${a.key.edge}`, base: at(a.plane.anchor), tip: at(a.plane.tip) }));
    },
    /** Page positions of the 32 points on each tilt ring, ids tilt-x+/tilt-x-/tilt-y+/tilt-y- (none while the section is folded or the band is hidden). */
    tiltRings: (): { id: string; pts: ({ x: number; y: number } | null)[] }[] => {
      const s = store.get();
      const r = canvas.getBoundingClientRect();
      return bandGizmo(s, size().h).rings.map((g) => ({
        id: g.id,
        pts: (g.handle.ring ?? []).map((p) => {
          const q = project(s.camera, p, [0, 0, 0], size());
          return q ? { x: r.left + q.x, y: r.top + q.y } : null;
        }),
      }));
    },
  };
  (window as unknown as { __editor: typeof hook }).__editor = hook;
}
