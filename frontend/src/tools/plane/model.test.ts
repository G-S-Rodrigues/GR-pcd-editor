import { describe, expect, it } from "vitest";
import { createAppStore } from "../../state/app";
import { sessionFixture } from "../../testing/fixtures";
import { buildSelection, currentTool } from "../../orchestration/selection";
import { armTool } from "../../orchestration/toolstate";
import { NO_PLANE_REASON, type DetectedPlane, defaultPlane, planeRows, planeSummary, setMaxPlanes, setMaxTilt, setPlaneDistance, toPlaneTool } from "./model";
import { defaultThin, setThinDistance, setThinEdge, setThinMethod, thinSummary, toThinTool } from "../thin/model";

const box = { type: "box" as const, center: [0, 0, 0] as [number, number, number], dimensions: [1, 1, 1] as [number, number, number], rpy_deg: [0, 0, 0] as [number, number, number], mode: "inside" as const };
const sq = { type: "prism" as const, polygon: [[0, 0], [1, 0], [1, 1]] as [number, number][], z_min: -1, z_max: 1, mode: "inside" as const };
const chosen = { normal: [0, 0, 1] as [number, number, number], d: 0.5, thickness: 0.03 };
const det = (z: number, count: number, over: Partial<DetectedPlane> = {}): DetectedPlane => ({
  normal: [0, 0, 1], d: z, count, rms: 0.0123456, tilt_deg: 0, z_centre: z, bounds: { min: [0, 0, z], max: [1, 1, z] }, ...over,
});

describe("planes and thin tool models (20-5)", () => {
  it("UI-954 defaults carry the O7 values and the thin method duplicates at distance 0", () => {
    expect(defaultPlane()).toEqual({ distance: 0.03, maxTilt: 30, maxPlanes: 4, region: "none", excludeProtected: true });
    expect(defaultThin()).toEqual({ method: "duplicates", distance: 0, edge: 0.05, region: "none", excludeProtected: true });
  });

  it("UI-955 validation texts for distance, max tilt, max planes, method, thin distance and edge", () => {
    const p = defaultPlane();
    expect(setPlaneDistance(p, 0.1)).toEqual({ ok: true, model: { ...p, distance: 0.1 } });
    for (const bad of [0, -1, Number.NaN]) expect(setPlaneDistance(p, bad)).toMatchObject({ ok: false, model: p, error: expect.stringMatching(/Distance/) });
    expect(setMaxTilt(p, 45).ok).toBe(true);
    for (const bad of [0, 91, Number.NaN]) expect(setMaxTilt(p, bad)).toMatchObject({ ok: false, error: expect.stringMatching(/Max tilt/) });
    expect(setMaxPlanes(p, 8).ok).toBe(true);
    for (const bad of [0, 9, 2.5]) expect(setMaxPlanes(p, bad)).toMatchObject({ ok: false, error: expect.stringMatching(/whole number from 1 to 8/) });
    const t = defaultThin();
    expect(setThinMethod(t, "voxel")).toEqual({ ok: true, model: { ...t, method: "voxel" } });
    expect(setThinMethod(t, "x" as never).ok).toBe(false);
    expect(setThinDistance(t, 0).ok).toBe(true);
    expect(setThinDistance(t, 1e-3).ok).toBe(true);
    for (const bad of [-1e-9, Number.NaN]) expect(setThinDistance(t, bad)).toMatchObject({ ok: false, error: expect.stringMatching(/Distance/) });
    expect(setThinEdge(t, 0.1).ok).toBe(true);
    for (const bad of [0, -1, Number.NaN]) expect(setThinEdge(t, bad)).toMatchObject({ ok: false, error: expect.stringMatching(/edge/i) });
  });

  it("UI-956 the plane tool request needs a chosen plane and carries the region", () => {
    expect(toPlaneTool(defaultPlane(), null, box, sq)).toBeNull();
    expect(toPlaneTool(defaultPlane(), chosen, box, sq)).toEqual({ type: "plane", normal: [0, 0, 1], d: 0.5, thickness: 0.03, region: null, exclude_protected: true });
    expect(toPlaneTool({ ...defaultPlane(), region: "box", excludeProtected: false }, chosen, box, sq)).toMatchObject({ region: box, exclude_protected: false });
    expect(toPlaneTool({ ...defaultPlane(), region: "prism" }, chosen, box, sq)?.region).toEqual(sq);
    expect(toPlaneTool({ ...defaultPlane(), region: "prism" }, chosen, box, null)?.region).toBeNull();
    expect(toPlaneTool(defaultPlane(), { ...chosen, thickness: 0 }, box, sq)).toBeNull();
  });

  it("UI-957 the thin tool request for both methods; the region as for sparse", () => {
    expect(toThinTool(defaultThin(), box, sq)).toEqual({ type: "thin", method: "duplicates", distance: 0, edge: 0.05, region: null, exclude_protected: true });
    expect(toThinTool({ ...defaultThin(), method: "voxel", edge: 0.2, region: "box" }, box, sq)).toEqual({ type: "thin", method: "voxel", distance: 0, edge: 0.2, region: box, exclude_protected: true });
    expect(toThinTool({ ...defaultThin(), distance: -1 }, box, sq)).toBeNull();
    expect(toThinTool({ ...defaultThin(), method: "voxel", edge: 0 }, box, sq)).toBeNull();
    expect(toThinTool({ ...defaultThin(), method: "voxel", distance: -1 }, box, sq)).not.toBeNull(); // the distance is not used by the voxel method
  });

  it("UI-958 the summaries say what is selected, that the lowest index is kept (O2), that chains collapse (O3) and who counts as a copy (O10)", () => {
    expect(planeSummary(defaultPlane())).toMatch(/up to 4 .*Detected planes/);
    expect(planeSummary(defaultPlane())).toMatch(/changes nothing/);
    for (const m of [defaultThin(), { ...defaultThin(), distance: 0.001 }, { ...defaultThin(), method: "voxel" as const }]) {
      expect(thinSummary(m)).toMatch(/lowest index/);
      expect(thinSummary(m)).toMatch(/Exclude protected/);
    }
    expect(thinSummary(defaultThin())).toMatch(/exact duplicates/);
    expect(thinSummary({ ...defaultThin(), distance: 0.001 })).toMatch(/within 0\.001/);
    expect(thinSummary({ ...defaultThin(), distance: 0.001 })).toMatch(/chains collapse/);
    expect(thinSummary({ ...defaultThin(), method: "voxel", edge: 0.2 })).toMatch(/0\.2 cube/);
  });

  it("UI-959 rows: lowest and highest labels, z at the centre, tilt, exact count", () => {
    const rows = planeRows([det(0, 1600), det(1.5, 12345), det(3, 900, { tilt_deg: 2.34567 })], null);
    expect(rows.map((r) => r.label)).toEqual(["Lowest (floor?)", "Plane 2", "Highest (ceiling?)"]);
    expect(rows.map((r) => r.z)).toEqual(["0", "1.5", "3"]);
    expect(rows.map((r) => r.count)).toEqual(["1,600", "12,345", "900"]);
    expect(rows[2].tilt).toBe("2.346");
    expect(planeRows([det(0, 5)], null)[0].label).toBe("Lowest (floor?)");
    // no z at the centre from the server: computed from n.p = d at the active-bounds centre
    const tilted = det(0, 5, { normal: [0.6, 0, 0.8], d: 1, z_centre: null });
    expect(planeRows([tilted], { min: [0, 0, 0], max: [2, 2, 2] })[0].z).toBe("0.5");
  });

  it("UI-964 an armed Planes tool with no chosen plane says to detect first; with one it sends a first-selection replace", () => {
    const store = createAppStore();
    store.set({ session: sessionFixture() });
    store.update((s) => armTool(s, "plane"));
    expect(store.get().tool).toBe("plane");
    expect(currentTool(store.get())).toBeNull();
    const r = buildSelection(store.get());
    expect(!r.ok && r.reason).toBe(NO_PLANE_REASON);
    expect(NO_PLANE_REASON).toBe("Detect planes and choose one first");
    store.update((s) => ({ ...s, planes: { ...s.planes, chosen } }));
    const live = buildSelection({ ...store.get(), liveFirst: true });
    expect(live.ok && live.body).toMatchObject({ op: "replace", tool: { type: "plane", d: 0.5 } });
    store.update((s) => armTool(s, "thin"));
    expect(buildSelection({ ...store.get(), liveFirst: true })).toMatchObject({ ok: true, body: { tool: { type: "thin", method: "duplicates" } } });
    store.update((s) => ({ ...s, tools: { ...s.tools, thin: { ...s.tools.thin, distance: -1 } } }));
    const bad = buildSelection(store.get());
    expect(!bad.ok && bad.reason).toMatch(/Thin needs/);
  });
});
