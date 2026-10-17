import { project } from "../pick/ray";
import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import type { Vec3 } from "../state/types";
import { boxHandles } from "../tools/box/handles";

/**
 * Read-only hook for the browser smoke (`window.__editor`): the app state and the page position of every
 * box handle, so a real mouse can grab one. It changes nothing.
 */
export function installDebugHook(canvas: HTMLCanvasElement, store: Store<AppState>, size: () => { w: number; h: number }): void {
  const hook = {
    state: () => store.get(),
    handlePositions: (): { id: string; x: number; y: number }[] => {
      const s = store.get();
      const r = canvas.getBoundingClientRect();
      const zero: Vec3 = [0, 0, 0];
      return boxHandles(s.tools.box, s.camera, s.gizmo.local).flatMap((h) => {
        const p = project(s.camera, h.anchor, zero, size());
        return p ? [{ id: h.id, x: r.left + p.x, y: r.top + p.y }] : [];
      });
    },
  };
  (window as unknown as { __editor: typeof hook }).__editor = hook;
}
