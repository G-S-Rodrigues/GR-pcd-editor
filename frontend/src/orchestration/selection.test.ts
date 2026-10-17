import { describe, expect, it } from "vitest";
import { type AppState, initialState } from "../state/app";
import { candidateFixture, sessionFixture } from "../testing/fixtures";
import { setCenter, setDimensions } from "../tools/box/model";
import { addVertex, closePolygon, startDrawing } from "../tools/polygon/model";
import { setSeed } from "../tools/cluster/model";
import {
  buildSelection,
  clearRequest,
  invertNote,
  isDraftOp,
  scopeNotice,
} from "./selection";

const base = (over: Partial<AppState> = {}): AppState => {
  const s = initialState();
  const box = setDimensions(setCenter(s.tools.box, [1, 2, 3]).box, [4, 5, 6]).box;
  return { ...s, session: sessionFixture({ revision: { cloud: 9, params: 2 } }), tools: { ...s.tools, box }, ...over };
};
const BOX = { type: "box", center: [1, 2, 3], dimensions: [4, 5, 6], rpy_deg: [0, 0, 0], mode: "inside" };

describe("selection builder", () => {
  it("UI-66 every op x scope builds the exact body with the store's cloud revision", () => {
    for (const op of ["replace", "add", "subtract", "intersect"] as const) {
      for (const scope of ["displayed", "active"] as const) {
        const r = buildSelection(base({ tool: "box", op, scope }));
        expect(r).toEqual({
          ok: true,
          body: { cloud_revision: 9, op, scope, tool: BOX, evaluate_candidate: true },
        });
      }
    }
    // invert needs no tool and ignores the selected one
    const inv = buildSelection(base({ tool: "none", op: "invert", scope: "active" }));
    expect(inv).toEqual({ ok: true, body: { cloud_revision: 9, op: "invert", scope: "active", tool: null, evaluate_candidate: true } });
    expect(buildSelection(base({ tool: "none", op: "replace" })).ok).toBe(false);
    expect(buildSelection({ ...base({ tool: "box" }), session: null }).ok).toBe(false);
    expect(invertNote("displayed")).toMatch(/relative to displayed/);
    expect(invertNote("active")).toMatch(/relative to active/);
    expect(clearRequest(base())).toEqual({ cloud_revision: 9 });
  });

  it("UI-66 polygon and cluster bodies; missing geometry or seed give a reason, not a request", () => {
    const s0 = base({ tool: "polygon" });
    const noPoly = buildSelection(s0);
    expect(noPoly.ok).toBe(false);
    let poly = startDrawing(s0.tools.polygon);
    for (const p of [[0, 0], [4, 0], [4, 4]] as [number, number][]) poly = addVertex(poly, p);
    poly = closePolygon(poly).state;
    const ok = buildSelection({ ...s0, tools: { ...s0.tools, polygon: poly } });
    expect(ok.ok && ok.body.tool).toMatchObject({ type: "prism", polygon: [[0, 0], [4, 0], [4, 4]] });
    const c0 = base({ tool: "cluster" });
    expect(buildSelection(c0).ok).toBe(false);
    const withSeed = { ...c0, tools: { ...c0.tools, cluster: setSeed(c0.tools.cluster, { id: 5, point: [0, 0, 0] }) } };
    const c = buildSelection(withSeed);
    expect(c.ok && c.body.tool).toMatchObject({ type: "cluster", seed_id: 5, exclude_protected: true });
  });

  it("UI-67 outside-display-filter notice only for active scope with a count", () => {
    const cand = candidateFixture({ selected_outside_display_filter: 12 });
    expect(scopeNotice(base({ scope: "active", candidate: cand }))).toBe("12 selected points are outside the display filter");
    expect(scopeNotice(base({ scope: "displayed", candidate: cand }))).toBeNull();
    expect(scopeNotice(base({ scope: "active", candidate: candidateFixture() }))).toBeNull();
    expect(scopeNotice(base({ scope: "active", candidate: null }))).toBeNull();
  });

  it("UI-68 replace is live; add/subtract/intersect are drafts committed explicitly", () => {
    expect(isDraftOp("replace")).toBe(false);
    for (const op of ["add", "subtract", "intersect"] as const) expect(isDraftOp(op)).toBe(true);
    expect(isDraftOp("invert")).toBe(false);
  });
});
