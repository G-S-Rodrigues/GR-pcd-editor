import { describe, expect, it } from "vitest";
import type { Vec2 } from "./validate";
import { validatePolygon } from "./validate";
import {
  POLYGON_DEPTH_NOTE,
  addVertex,
  cancelDrawing,
  closePolygon,
  dragZ,
  emptyPolygon,
  enterTool,
  moveVertex,
  setVertexNumeric,
  setZ,
  startDrawing,
  toPrismTool,
} from "./model";

const sq: Vec2[] = [[0, 0], [4, 0], [4, 4], [0, 4]];
const draw = (pts: Vec2[]) => {
  let s = startDrawing(emptyPolygon());
  for (const p of pts) s = addVertex(s, p);
  return s;
};

describe("polygon validation", () => {
  it("UI-41 rejects each invalid shape with a specific message", () => {
    expect(validatePolygon([[0, 0], [1, 1]])).toMatch(/at least 3/);
    expect(validatePolygon([[0, 0], [0, 0], [1, 0], [0, 1]])).toMatch(/duplicate/);
    expect(validatePolygon([[0, 0], [1, 0], [0, 1], [0, 0]])).toMatch(/duplicate/);
    expect(validatePolygon([[0, 0], [1, 1], [2, 2]])).toMatch(/zero area|fold/);
    expect(validatePolygon([[0, 0], [4, 4], [4, 0], [0, 2]])).toMatch(/self-intersect/);
    // touching: vertex lies on a non-adjacent edge
    expect(validatePolygon([[0, 0], [4, 0], [4, 4], [2, 0], [0, 4]])).toMatch(/self-intersect/);
    expect(validatePolygon([[0, 0], [NaN, 0], [1, 1]])).toMatch(/finite/);
  });
  it("UI-41 accepts concave simple polygons in either winding", () => {
    const concave: Vec2[] = [[0, 0], [6, 0], [6, 6], [3, 2], [0, 6]];
    expect(validatePolygon(concave)).toBeNull();
    expect(validatePolygon([...concave].reverse())).toBeNull();
    expect(validatePolygon(sq)).toBeNull();
  });
});

describe("polygon model", () => {
  it("UI-42 z limits: min>max or non-finite keeps the previous prism", () => {
    const s = closePolygon(draw(sq)).state;
    const bad = setZ(s, 5, 1);
    expect(bad.ok).toBe(false);
    expect(bad.state).toBe(s);
    expect(setZ(s, NaN, 1).ok).toBe(false);
    const good = setZ(s, -1, 3);
    expect(good.ok).toBe(true);
    expect([good.state.zMin, good.state.zMax]).toEqual([-1, 3]);
  });

  it("UI-43 state machine: click, Enter, Escape", () => {
    let s = draw([[0, 0], [4, 0]]);
    expect(s.phase).toBe("drawing");
    let r = closePolygon(s); // only 2 vertices
    expect(r.ok).toBe(false);
    expect(r.state.phase).toBe("drawing");
    expect(r.message).toMatch(/at least 3/);
    s = addVertex(s, [4, 4]);
    r = closePolygon(s);
    expect(r.ok).toBe(true);
    expect(r.state.phase).toBe("closed");
    // Escape while redrawing restores the previous closed polygon
    const redraw = addVertex(startDrawing(r.state), [9, 9]);
    const back = cancelDrawing(redraw);
    expect(back.phase).toBe("closed");
    expect(back.vertices).toEqual([[0, 0], [4, 0], [4, 4]]);
    // Escape on a first drawing returns to idle with no vertices
    const idle = cancelDrawing(draw([[1, 1]]));
    expect(idle.phase).toBe("idle");
    expect(idle.vertices).toEqual([]);
  });

  it("UI-43 Enter on an invalid polygon keeps drawing", () => {
    const r = closePolygon(draw([[0, 0], [4, 4], [4, 0], [0, 2]]));
    expect(r.ok).toBe(false);
    expect(r.state.phase).toBe("drawing");
    expect(r.message).toMatch(/self-intersect/);
  });

  it("UI-44 vertex drag/numeric edit validates; invalid results flagged and not sent", () => {
    const s = setZ(closePolygon(draw(sq)).state, 0, 2).state;
    const ok = moveVertex(s, 2, [5, 5]);
    expect(ok.ok).toBe(true);
    expect(ok.state.vertices[2]).toEqual([5, 5]);
    const cross = moveVertex(s, 2, [0, -4]);
    expect(cross.ok).toBe(false);
    expect(cross.state.vertices).toEqual(s.vertices); // previous kept
    expect(cross.invalidPreview).toEqual([[0, 0], [4, 0], [0, -4], [0, 4]]);
    expect(cross.message).toBeTruthy();
    expect(toPrismTool(s)?.polygon).toEqual(sq);
    expect(setVertexNumeric(s, 1, [NaN, 0]).ok).toBe(false);
    expect(setVertexNumeric(s, 1, [6, 0]).state.vertices[1]).toEqual([6, 0]);
    // Z handle drag
    const z = dragZ(s, "zMax", 1.5);
    expect(z.zMax).toBe(3.5);
    expect(dragZ(s, "zMin", 5).zMin).toBe(2); // clamped to zMax
  });

  it("UI-45 prism request keeps world coordinates exact; entering the tool asks for the top view", () => {
    const big: Vec2[] = [[1000000.5, 2000000.25], [1000004.5, 2000000.25], [1000004.5, 2000004.25]];
    const s = setZ(closePolygon(draw(big)).state, 1.5, 9).state;
    expect(toPrismTool(s)).toEqual({ type: "prism", polygon: big, z_min: 1.5, z_max: 9, mode: "inside" });
    expect(enterTool().view).toBe("top");
    expect(POLYGON_DEPTH_NOTE).toMatch(/through the view depth unless Z limits are enabled/);
  });

  it("UI-46 inside/outside mode is carried; undrawn or invalid polygon gives no request", () => {
    expect(toPrismTool(emptyPolygon())).toBeNull();
    expect(toPrismTool(draw(sq))).toBeNull(); // not closed
    const closed = closePolygon(draw(sq)).state;
    expect(toPrismTool({ ...closed, mode: "outside" })?.mode).toBe("outside");
  });
});
