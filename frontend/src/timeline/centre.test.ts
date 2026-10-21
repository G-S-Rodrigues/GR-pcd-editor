import { describe, expect, it } from "vitest";
import { createAppStore } from "../state/app";
import type { Bounds } from "../state/types";
import { sessionFixture } from "../testing/fixtures";
import { defaultCamera } from "../view/camera";
import { applyPreset } from "../view/presets";
import { centreOnBounds, createStepCentre } from "./centre";

const b: Bounds = { min: [10, 20, 0], max: [14, 24, 2] };
const entries = [
  { index: 0, kind: "delete", description: "a", count: 3, sid: 1, bounds: b },
  { index: 1, kind: "delete", description: "b", count: 3, sid: 2, bounds: null },
];

describe("history click centres the camera (13-8)", () => {
  it("UI-669 centring moves the target to the bounds and frames them without turning the camera", () => {
    for (const preset of ["top", "front", "left"] as const) {
      const cam = applyPreset({ ...defaultCamera(), distance: 3 }, preset);
      const next = centreOnBounds(cam, b, 1.5);
      expect(next.target).toEqual([12, 22, 1]);
      expect(next.distance).toBeGreaterThan(0);
      expect(next.orientation).toEqual(cam.orientation);
      expect(next.ortho).toBe(cam.ortho);
    }
  });

  it("UI-670 a new highlight centres the camera once; clearing it, hovering and a step without bounds do not", () => {
    const store = createAppStore();
    const camera = applyPreset(defaultCamera(), "front");
    store.set({ session: sessionFixture({ history: { entries, cursor: 2, can_undo: true, can_redo: false } }), camera });
    const centre = createStepCentre(store, () => ({ w: 900, h: 600 }));
    store.set({ timeline: { ...store.get().timeline, hover: 1 } });
    expect(store.get().camera).toBe(camera);
    store.set({ timeline: { ...store.get().timeline, hover: null, highlight: 1 } });
    expect(store.get().camera.target).toEqual([12, 22, 1]);
    expect(store.get().camera.orientation).toEqual(camera.orientation);
    const moved = store.get().camera;
    store.set({ camera: { ...moved, target: [0, 0, 0] } });
    store.set({ timeline: { ...store.get().timeline, highlight: 2 } }); // no finite points: stay put
    expect(store.get().camera.target).toEqual([0, 0, 0]);
    store.set({ timeline: { ...store.get().timeline, highlight: null } });
    expect(store.get().camera.target).toEqual([0, 0, 0]);
    // the same step highlighted again after a clear centres again
    store.set({ timeline: { ...store.get().timeline, highlight: 1 } });
    expect(store.get().camera.target).toEqual([12, 22, 1]);
    centre.dispose();
    store.set({ camera: { ...store.get().camera, target: [0, 0, 0] }, timeline: { ...store.get().timeline, highlight: null } });
    store.set({ timeline: { ...store.get().timeline, highlight: 1 } });
    expect(store.get().camera.target).toEqual([0, 0, 0]);
  });
});
