import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import type { Bounds } from "../state/types";
import type { Camera } from "../view/camera";
import { fitBounds } from "../view/fit";

/** Frames `b` without turning the camera: only the target (the pivot) and the distance change. */
export const centreOnBounds = (c: Camera, b: Bounds, aspect: number): Camera => fitBounds(c, b, aspect);

/**
 * Highlighting a history step (click or keyboard) centres the camera on that step's points. A hover, clearing the
 * highlight and a step with no finite point move nothing. The same step highlighted again after a clear centres again.
 */
export function createStepCentre(store: Store<AppState>, size: () => { w: number; h: number }) {
  let last: number | null = store.get().timeline.highlight;
  const unsub = store.subscribe((s) => {
    const sid = s.timeline.highlight;
    if (sid === last) return;
    last = sid;
    if (sid === null) return;
    const bounds = s.session?.history.entries.find((e) => (e.sid ?? e.index) === sid)?.bounds;
    if (!bounds) return;
    const { w, h } = size();
    store.set({ camera: centreOnBounds(s.camera, bounds, w / Math.max(h, 1)) });
  });
  return { dispose: unsub };
}
