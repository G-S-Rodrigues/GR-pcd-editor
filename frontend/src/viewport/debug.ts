import { filterPlanes } from "../filterboxes/plane";
import { tiltRings } from "../inspector/rings";
import { planeAnchors } from "./interact";
import { project } from "../pick/ray";
import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import type { Vec3 } from "../state/types";
import { boxHandles } from "../tools/box/handles";

/**
 * Read-only hook for the browser smoke (`window.__editor`): the app state and the page position of every
 * box handle, so a real mouse can grab one. It changes nothing.
 */
export function installDebugHook(canvas: HTMLCanvasElement, store: Store<AppState>, size: () => { w: number; h: number }, drawnCount: () => number = () => 0): void {
  const hook = {
    state: () => store.get(),
    /** Points the main layer draws right now (lower while the camera moves). */
    drawnCount,
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
      return boxHandles(s.tools.box, s.camera, s.gizmo.local, size().h, size().w).flatMap((h) => {
        const p = project(s.camera, h.anchor, zero, size());
        return p ? [{ id: h.id, x: r.left + p.x, y: r.top + p.y }] : [];
      });
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
      return planeAnchors(s, size().h).map((a) => ({ key: `${a.key.which}-${a.key.edge}`, base: at(a.anchor), tip: at(a.tip) }));
    },
    /** Page positions of 48 points on each shown rotation ring (null while the section is folded). */
    tiltRings: (): { id: string; pts: ({ x: number; y: number } | null)[] }[] => {
      const s = store.get();
      const r = canvas.getBoundingClientRect();
      return tiltRings(s, size().h).map((g) => ({
        id: g.id,
        pts: g.pts.map((p) => {
          const q = project(s.camera, p, [0, 0, 0], size());
          return q ? { x: r.left + q.x, y: r.top + q.y } : null;
        }),
      }));
    },
  };
  (window as unknown as { __editor: typeof hook }).__editor = hook;
}
