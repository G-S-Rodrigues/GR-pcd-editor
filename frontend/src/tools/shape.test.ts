import { describe, expect, it } from "vitest";
import { toBoxTool } from "./box/model";
import { createAppStore } from "../state/app";
import type { StepBox, StepCluster, StepPrism, StepShape, StepSparse } from "../state/types";
import { toPrismTool } from "./polygon/model";
import { toClusterTool } from "./cluster/model";
import { toSparseTool } from "./sparse/model";
import { EDIT_SHAPE_UNAVAILABLE, editShapeState, shapeToPatch } from "./shape";

const st = () => createAppStore().get();
const box: StepBox = { type: "box", center: [10.5, -2, 3], dimensions: [4, 2, 1.5], rpy_deg: [12.5, -33, 170], mode: "inside" };
const prism: StepPrism = { type: "prism", polygon: [[0, 0], [6, 0], [6, 4], [3, 2], [0, 4]], z_min: -1, z_max: 2.5, mode: "outside" };
const patch = (shape: StepShape, centre: [number, number, number] | null = null) => {
  const r = shapeToPatch(shape, st(), centre);
  if (!r.ok) throw new Error(r.reason);
  return r.patch;
};

describe("step shape to tool state (13-8)", () => {
  it("UI-671 a box shape arms the Box tool and comes back as the same request, rpy to 1e-12", () => {
    const p = patch(box);
    expect(p.tool).toBe("box");
    const back = toBoxTool(p.tools!.box);
    expect(back.type).toBe("box");
    expect(back.mode).toBe("inside");
    for (let i = 0; i < 3; i++) {
      expect(back.center[i]).toBe(box.center[i]);
      expect(back.dimensions[i]).toBe(box.dimensions[i]);
      expect(Math.abs(back.rpy_deg[i] - box.rpy_deg[i])).toBeLessThan(1e-12);
    }
  });

  it("UI-672 a prism shape arms the Polygon tool with a closed polygon in edit mode and the same prism request", () => {
    const p = patch(prism);
    expect(p.tool).toBe("polygon");
    const poly = p.tools!.polygon;
    expect(poly.phase).toBe("closed");
    expect(poly.editing).toBe(true);
    expect(poly.previous).toBeNull();
    expect(toPrismTool(poly)).toEqual(prism);
  });

  it("UI-672 a stored polygon that no longer validates is refused with the reason, not half applied", () => {
    const bad: StepPrism = { ...prism, polygon: [[0, 0], [4, 4], [4, 0], [0, 2]] };
    const r = shapeToPatch(bad, st(), null);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/self-intersect/);
  });

  it("UI-673 a cluster shape seeds Cluster with the seed id and its parameters; the seed point is the step centre", () => {
    const shape: StepCluster = { type: "cluster", seed_id: 4321, radius: 0.75, max_points: 5000, exclude_protected: false, region: null };
    const p = patch(shape, [1, 2, 3]);
    expect(p.tool).toBe("cluster");
    expect(p.interaction).toBe("orbit");
    const c = p.tools!.cluster;
    expect(c.seed).toEqual({ id: 4321, point: [1, 2, 3] });
    expect(c).toMatchObject({ radius: 0.75, maxPoints: 5000, excludeProtected: false, region: "none" });
    expect(toClusterTool(c, null, null)).toMatchObject({ type: "cluster", seed_id: 4321, radius: 0.75, max_points: 5000, exclude_protected: false, region: null });
    expect(patch(shape, null).tools!.cluster.seed?.point).toEqual([0, 0, 0]);
  });

  it("UI-673 the nested region of a cluster comes back as the box or polygon tool state and the region choice", () => {
    const withBox: StepCluster = { type: "cluster", seed_id: 1, radius: 1, max_points: null, exclude_protected: true, region: box };
    const a = patch(withBox);
    expect(a.tools!.cluster.region).toBe("box");
    expect(a.tools!.cluster.maxPoints).toBeNull();
    expect(toClusterTool(a.tools!.cluster, toBoxTool(a.tools!.box), null)?.region).toMatchObject({ type: "box", center: box.center, dimensions: box.dimensions });
    const withPrism: StepCluster = { ...withBox, region: prism };
    const b = patch(withPrism);
    expect(b.tools!.cluster.region).toBe("prism");
    expect(toPrismTool(b.tools!.polygon)).toEqual(prism);
    expect(b.tools!.polygon.editing).toBe(false); // the polygon is a region here, not the tool being edited
  });

  it("UI-674 a sparse shape arms Sparse points with its parameters and region", () => {
    const shape: StepSparse = { type: "sparse", radius: null, min_neighbours: 6, exclude_protected: true, region: box };
    const p = patch(shape);
    expect(p.tool).toBe("sparse");
    expect(p.tools!.sparse).toEqual({ radius: null, minNeighbours: 6, region: "box", excludeProtected: true });
    expect(toSparseTool(p.tools!.sparse, toBoxTool(p.tools!.box), null)).toMatchObject({ type: "sparse", radius: null, min_neighbours: 6, exclude_protected: true });
    const r = patch({ ...shape, radius: 0.3, region: null });
    expect(r.tools!.sparse).toMatchObject({ radius: 0.3, region: "none" });
  });

  it("UI-675 every patch starts a live first selection with no draft, preview or stale candidate", () => {
    for (const s of [box, prism, { type: "sparse", radius: null, min_neighbours: 8, exclude_protected: true, region: null } as StepSparse]) {
      const p = patch(s);
      expect(p).toMatchObject({ liveFirst: true, draft: false, preview: null, candidate: null });
    }
  });

  it("UI-675 a step with no stored shape cannot be edited: the button is disabled and says why", () => {
    const none = editShapeState({ index: 0, kind: "delete", description: "", count: 1, sid: 5, shape: null }, 1);
    expect(none.enabled).toBe(false);
    expect(none.title).toBe(EDIT_SHAPE_UNAVAILABLE);
    expect(EDIT_SHAPE_UNAVAILABLE).toBe("This step was saved before shapes were stored; centre only");
    const absent = editShapeState({ index: 0, kind: "delete", description: "", count: 1 }, 1);
    expect(absent.enabled).toBe(false);
    const ok = editShapeState({ index: 1, kind: "delete", description: "", count: 1, sid: 6, shape: box }, 2);
    expect(ok.enabled).toBe(true);
    expect(ok.label).toBe("Edit the shape of step 2");
    expect(ok.title).toMatch(/Edit the shape/);
  });
});
