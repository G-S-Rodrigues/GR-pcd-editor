import { describe, expect, it } from "vitest";
import { createAppStore } from "../../state/app";
import { sessionFixture } from "../../testing/fixtures";
import { buildSelection, currentTool } from "../../orchestration/selection";
import { armTool } from "../../orchestration/toolstate";
import { DEFAULT_MIN_NEIGHBOURS, defaultSparse, setMinNeighbours, setSparseRadius, sparseSummary, toSparseTool } from "./model";

const sq = { type: "prism" as const, polygon: [[0, 0], [1, 0], [1, 1]] as [number, number][], z_min: -1, z_max: 1, mode: "inside" as const };
const box = { type: "box" as const, center: [0, 0, 0] as [number, number, number], dimensions: [1, 1, 1] as [number, number, number], rpy_deg: [0, 0, 0] as [number, number, number], mode: "inside" as const };

describe("sparse points tool model (13-8)", () => {
  it("UI-678 defaults: radius derived by the server, 8 neighbours, whole cloud, protected points kept", () => {
    expect(defaultSparse()).toEqual({ radius: null, minNeighbours: DEFAULT_MIN_NEIGHBOURS, region: "none", excludeProtected: true });
    expect(DEFAULT_MIN_NEIGHBOURS).toBe(8);
  });

  it("UI-678 the radius is empty (derived) or above 0; the neighbour count is a whole number of at least 1", () => {
    const m = defaultSparse();
    expect(setSparseRadius(m, 0.25)).toEqual({ ok: true, model: { ...m, radius: 0.25 } });
    expect(setSparseRadius({ ...m, radius: 0.25 }, null)).toEqual({ ok: true, model: m });
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = setSparseRadius(m, bad);
      expect(r.ok).toBe(false);
      expect(r.model).toBe(m);
      expect(r.error).toMatch(/Radius/);
    }
    expect(setMinNeighbours(m, 12)).toEqual({ ok: true, model: { ...m, minNeighbours: 12 } });
    for (const bad of [0, 2.5, -3, Number.NaN]) {
      const r = setMinNeighbours(m, bad);
      expect(r.ok).toBe(false);
      expect(r.model).toBe(m);
      expect(r.error).toMatch(/whole number/);
    }
  });

  it("UI-679 the request carries the parameters and the chosen region; an unavailable region means the whole cloud", () => {
    expect(toSparseTool(defaultSparse(), box, sq)).toEqual({ type: "sparse", radius: null, min_neighbours: 8, region: null, exclude_protected: true });
    expect(toSparseTool({ ...defaultSparse(), radius: 0.3, minNeighbours: 5, region: "box", excludeProtected: false }, box, sq)).toEqual({
      type: "sparse",
      radius: 0.3,
      min_neighbours: 5,
      region: box,
      exclude_protected: false,
    });
    expect(toSparseTool({ ...defaultSparse(), region: "prism" }, box, sq)?.region).toEqual(sq);
    expect(toSparseTool({ ...defaultSparse(), region: "prism" }, box, null)?.region).toBeNull();
    expect(toSparseTool({ ...defaultSparse(), radius: -2 }, box, sq)).toBeNull();
    expect(toSparseTool({ ...defaultSparse(), minNeighbours: 0 }, box, sq)).toBeNull();
  });

  it("UI-680 the selection request for the Sparse tool is a first-selection replace, then an op against the selection", () => {
    const store = createAppStore();
    store.set({ session: sessionFixture() });
    store.update((s) => armTool(s, "sparse"));
    expect(store.get().tool).toBe("sparse");
    expect(store.get().interaction).toBe("orbit");
    expect(currentTool(store.get())).toMatchObject({ type: "sparse", min_neighbours: 8 });
    const live = buildSelection({ ...store.get(), liveFirst: true });
    expect(live.ok && live.body.op).toBe("replace");
    expect(live.ok && live.body.tool).toMatchObject({ type: "sparse" });
    const add = buildSelection({ ...store.get(), liveFirst: false, op: "add" });
    expect(add.ok && add.body.op).toBe("add");
    store.update((s) => ({ ...s, tools: { ...s.tools, sparse: { ...s.tools.sparse, minNeighbours: 0 } } }));
    const bad = buildSelection(store.get());
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.reason).toMatch(/neighbour|radius/i);
  });

  it("UI-681 the summary line says what the tool selects in plain words", () => {
    expect(sparseSummary(defaultSparse())).toMatch(/fewer than 8 points around them/);
    expect(sparseSummary(defaultSparse())).toMatch(/radius from the point spacing/i);
    expect(sparseSummary({ ...defaultSparse(), radius: 0.5, minNeighbours: 3 })).toMatch(/fewer than 3 points.*0\.5/);
  });
});
