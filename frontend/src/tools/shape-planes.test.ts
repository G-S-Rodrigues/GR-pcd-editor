import { describe, expect, it } from "vitest";
import { createAppStore } from "../state/app";
import type { StepBox, StepPlane, StepShape, StepThin } from "../state/types";
import { buildSelection } from "../orchestration/selection";
import { toPlaneTool } from "./plane/model";
import { toThinTool } from "./thin/model";
import { toBoxTool } from "./box/model";
import { sessionFixture } from "../testing/fixtures";
import { shapeToPatch } from "./shape";

const box: StepBox = { type: "box", center: [10.5, -2, 3], dimensions: [4, 2, 1.5], rpy_deg: [0, 0, 0], mode: "inside" };
const patch = (shape: StepShape) => {
  const r = shapeToPatch(shape, createAppStore().get(), null);
  if (!r.ok) throw new Error(r.reason);
  return r.patch;
};

describe("Edit shape for plane and thin steps (20-5)", () => {
  it("UI-963 a plane step arms Planes with the stored plane and parameters; a thin step arms Thin with its method", () => {
    const plane: StepPlane = { type: "plane", normal: [0, 0.6, 0.8], d: 1.25, thickness: 0.04, exclude_protected: false, region: box };
    const p = patch(plane);
    expect(p.tool).toBe("plane");
    expect(p.liveFirst).toBe(true);
    expect(p.tools!.plane).toMatchObject({ distance: 0.04, excludeProtected: false, region: "box" });
    expect(p.planes!.chosen).toEqual({ normal: [0, 0.6, 0.8], d: 1.25, thickness: 0.04 });
    expect(toPlaneTool(p.tools!.plane, p.planes!.chosen, toBoxTool(p.tools!.box), null)).toMatchObject({ type: "plane", normal: [0, 0.6, 0.8], d: 1.25, thickness: 0.04, exclude_protected: false });
    // the stored plane is used as it is: no detection runs, so the list is untouched
    expect(p.planes!.list).toBeNull();
    const thin: StepThin = { type: "thin", method: "voxel", distance: 0, edge: 0.2, exclude_protected: true, region: null };
    const t = patch(thin);
    expect(t.tool).toBe("thin");
    expect(t.tools!.thin).toEqual({ method: "voxel", distance: 0, edge: 0.2, region: "none", excludeProtected: true });
    expect(toThinTool(t.tools!.thin, null, null)).toMatchObject({ type: "thin", method: "voxel", edge: 0.2 });
    const dup = patch({ ...thin, method: "duplicates", distance: 0.001, region: box });
    expect(dup.tools!.thin).toMatchObject({ method: "duplicates", distance: 0.001, region: "box" });
  });

  it("UI-982 Edit shape on a plane step selects with the stored plane even when the detected list is empty", () => {
    const store = createAppStore();
    const plane: StepPlane = { type: "plane", normal: [0, 0, 1], d: 3, thickness: 0.03, exclude_protected: true, region: null };
    const r = shapeToPatch(plane, store.get(), null);
    if (!r.ok) throw new Error(r.reason);
    store.update((s) => ({ ...s, ...r.patch }));
    expect(store.get().planes.list).toBeNull();
    expect(store.get().planes.chosen).not.toBeNull();
    expect(store.get().tool).toBe("plane");
    store.set({ session: sessionFixture() });
    const b = buildSelection(store.get());
    expect(b.ok && b.body.tool).toMatchObject({ type: "plane", d: 3 });
  });
});
