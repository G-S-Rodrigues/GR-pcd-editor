import { describe, expect, it } from "vitest";
import { candidateFixture } from "../../testing/fixtures";
import {
  CLUSTER_LIMIT_TEXT,
  MEMORY_GUARD_TEXT,
  clusterErrorText,
  clusterLimitText,
  clusterPanel,
  defaultCluster,
  regionOptions,
  setRadius,
  setSeed,
  toClusterTool,
} from "./model";

const boxTool = { type: "box" as const, center: [0, 0, 0] as [number, number, number], dimensions: [1, 1, 1] as [number, number, number], rpy_deg: [0, 0, 0] as [number, number, number], mode: "inside" as const };

describe("cluster model", () => {
  it("UI-62 request shape; radius finite > 0; no seed -> no request", () => {
    const m = defaultCluster();
    expect(toClusterTool(m, null, null)).toBeNull();
    const s = setSeed(m, { id: 17, point: [1, 2, 3] });
    expect(toClusterTool(s, null, null)).toEqual({
      type: "cluster",
      seed_id: 17,
      radius: s.radius,
      region: null,
      exclude_protected: true,
      max_points: 2_000_000,
    });
    for (const bad of [0, -1, NaN, Infinity]) {
      const r = setRadius(s, bad);
      expect(r.ok).toBe(false);
      expect(r.model).toBe(s);
    }
    expect(setRadius(s, 0.25).model.radius).toBe(0.25);
  });

  it("UI-63 regions only when that tool has valid geometry", () => {
    expect(regionOptions(null, null)).toEqual(["none"]);
    expect(regionOptions(boxTool, null)).toEqual(["none", "box"]);
    const s = { ...setSeed(defaultCluster(), { id: 1, point: [0, 0, 0] }), region: "box" as const };
    expect(toClusterTool(s, boxTool, null)?.region).toEqual(boxTool);
    // region chosen but its geometry vanished -> falls back to none
    expect(toClusterTool(s, null, null)?.region).toBeNull();
    expect(defaultCluster().scope).toBe("displayed");
  });

  it("UI-64 result panel from the candidate", () => {
    const c = candidateFixture({
      candidates: 40,
      selected_active: 45,
      bounds: { min: [0, 0, 0], max: [1, 2, 3] },
      cluster: { seed_id: 17, radius: 0.5, size: 45, bounds: { min: [0, 0, 0], max: [1, 2, 3] } },
    });
    const rows = Object.fromEntries(clusterPanel(c).map((r) => [r.label, r.value]));
    expect(rows.Seed).toBe("17");
    expect(rows.Radius).toBe("0.5");
    expect(rows.Size).toBe("45");
    expect(rows.Candidates).toBe("40");
    expect(rows.Bounds).toMatch(/0.*1.*2.*3/);
    expect(clusterPanel(null)).toEqual([]);
  });

  it("UI-65 component limit is never shown as complete", () => {
    expect(clusterErrorText("component_limit_reached")).toBe(CLUSTER_LIMIT_TEXT);
    expect(CLUSTER_LIMIT_TEXT).toMatch(/Expansion paused/);
    expect(CLUSTER_LIMIT_TEXT).toMatch(/not complete/);
    expect(clusterErrorText("other")).toBeNull();
    const m = defaultCluster();
    expect(m.maxPoints).toBe(2_000_000);
  });
});

describe("cluster partial results (F-04)", () => {
  it("UI-109 a limit hit is reported as partial with a way out; a complete cluster says nothing", () => {
    const partial = candidateFixture({
      cluster: { seed_id: 3, radius: 0.5, size: 41, complete: false, limit: 40, bounds: { min: [0, 0, 0], max: [1, 1, 1] } },
    });
    expect(clusterLimitText(partial)).toBe("Stopped at 40 points; raise Max points or clear the field for no limit");
    const done = candidateFixture({ cluster: { seed_id: 3, radius: 0.5, size: 41, complete: true, limit: null, bounds: { min: [0, 0, 0], max: [1, 1, 1] } } });
    expect(clusterLimitText(done)).toBeNull();
    expect(clusterLimitText(candidateFixture())).toBeNull();
    expect(clusterLimitText(null)).toBeNull();
  });

  it("UI-150 memory_guard has its own text; radius_too_small keeps the server message with the minimum", () => {
    expect(clusterErrorText("memory_guard")).toBe(MEMORY_GUARD_TEXT);
    expect(MEMORY_GUARD_TEXT).toMatch(/memory/);
    expect(clusterErrorText("radius_too_small")).toBeNull();
  });
});
