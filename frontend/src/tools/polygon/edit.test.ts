import { describe, expect, it } from "vitest";
import { polygonHint, polygonKeyAction } from "./edit";
import { addVertex, closePolygon, emptyPolygon, insertVertex, removeVertex, setEditing, startDrawing } from "./model";
import type { Vec2 } from "./validate";

const sq: Vec2[] = [[0, 0], [4, 0], [4, 4], [0, 4]];
const closed = () => {
  let s = startDrawing(emptyPolygon());
  for (const p of sq) s = addVertex(s, p);
  return closePolygon(s).state;
};

describe("polygon edit mode (13-7)", () => {
  it("UI-655 insertVertex puts a vertex after the edge's first vertex and keeps the others in order", () => {
    const r = insertVertex(closed(), 1, [4, 2]);
    expect(r.ok).toBe(true);
    expect(r.state.vertices).toEqual([[0, 0], [4, 0], [4, 2], [4, 4], [0, 4]]);
    // the closing edge (last vertex back to the first) takes the new vertex at the end
    const last = insertVertex(closed(), 3, [0, 2]);
    expect(last.state.vertices).toEqual([[0, 0], [4, 0], [4, 4], [0, 4], [0, 2]]);
  });

  it("UI-655 an insert that makes the polygon invalid is refused, flagged in red and changes nothing", () => {
    const s = closed();
    const r = insertVertex(s, 0, [3, 6]); // pulls the bottom edge across the top
    expect(r.ok).toBe(false);
    expect(r.state).toBe(s);
    expect(r.invalidPreview).toEqual([[0, 0], [3, 6], [4, 0], [4, 4], [0, 4]]);
    expect(r.message).toMatch(/self-intersect/);
    expect(insertVertex(s, 9, [1, 1]).ok).toBe(false);
    expect(insertVertex(s, -1, [1, 1]).ok).toBe(false);
    expect(insertVertex(startDrawing(s), 0, [1, 1]).ok).toBe(false); // only a closed polygon is edited
  });

  it("UI-656 removeVertex drops one vertex, never below three, and refuses a result that crosses itself", () => {
    const r = removeVertex(closed(), 2);
    expect(r.ok).toBe(true);
    expect(r.state.vertices).toEqual([[0, 0], [4, 0], [0, 4]]);
    const three = r.state;
    const refused = removeVertex(three, 0);
    expect(refused.ok).toBe(false);
    expect(refused.state).toBe(three);
    expect(refused.message).toMatch(/at least 3/);
    // taking a corner of a slotted shape can drag an edge across the slot
    const u: Vec2[] = [[0, 0], [10, 0], [10, 10], [6, 10], [6, 2], [4, 2], [4, 10], [0, 10]];
    const slot = closePolygon({ ...startDrawing(emptyPolygon()), vertices: u }).state;
    expect(slot.phase).toBe("closed");
    const cut = removeVertex(slot, 1);
    expect(cut.ok).toBe(false);
    expect(cut.message).toMatch(/self-intersect/);
    expect(cut.invalidPreview).toHaveLength(7);
    expect(removeVertex(slot, 4).ok).toBe(true);
    expect(removeVertex(closed(), 7).ok).toBe(false);
  });

  it("UI-657 the edit flag exists only on a closed polygon and every restart clears it", () => {
    expect(emptyPolygon().editing).toBe(false);
    expect(setEditing(emptyPolygon(), true).editing).toBe(false);
    expect(setEditing(startDrawing(emptyPolygon()), true).editing).toBe(false);
    const on = setEditing(closed(), true);
    expect(on.editing).toBe(true);
    expect(setEditing(on, false).editing).toBe(false);
    expect(startDrawing(on).editing).toBe(false);
    // an edit keeps the flag on
    expect(insertVertex(on, 0, [2, 0]).state.editing).toBe(true);
  });

  it("UI-666 the hint walks the three steps and the Draw button is highlighted only until a polygon exists", () => {
    const idle = polygonHint(emptyPolygon());
    expect(idle.text).toMatch(/1.*Draw polygon.*2.*Click.*3.*Enter/s);
    expect(idle.accentDraw).toBe(true);
    const drawing = polygonHint(addVertex(startDrawing(emptyPolygon()), [0, 0]));
    expect(drawing.accentDraw).toBe(false);
    expect(drawing.text).toMatch(/Drawing: 1 vertex\b/);
    const shut = polygonHint(closed());
    expect(shut.accentDraw).toBe(false);
    expect(shut.text).toMatch(/Polygon closed/);
    expect(polygonHint(setEditing(closed(), true)).text).toMatch(/Edit mode.*click an edge.*Backspace/s);
  });

  it("UI-667 Enter and Esc leave edit mode keeping the shape; they keep their old meaning otherwise", () => {
    const edit = setEditing(closed(), true);
    expect(polygonKeyAction(edit, "polygon-close")).toBe("leave-edit");
    expect(polygonKeyAction(edit, "cancel")).toBe("leave-edit");
    const drawing = addVertex(startDrawing(emptyPolygon()), [0, 0]);
    expect(polygonKeyAction(drawing, "polygon-close")).toBe("close");
    expect(polygonKeyAction(drawing, "cancel")).toBe("cancel-drawing");
    expect(polygonKeyAction(closed(), "polygon-close")).toBeNull();
    expect(polygonKeyAction(closed(), "cancel")).toBeNull();
    expect(polygonKeyAction(edit, "polygon-remove-vertex")).toBe("remove-vertex");
    expect(polygonKeyAction(closed(), "polygon-remove-vertex")).toBeNull(); // Backspace removes only in edit mode
    expect(polygonKeyAction(edit, "apply")).toBeNull(); // Delete stays Apply
    // Enter on a focused button activates that button (the pencil toggles itself): it must not also leave the mode
    expect(polygonKeyAction(edit, "polygon-close", "BUTTON")).toBeNull();
    expect(polygonKeyAction(edit, "cancel", "BUTTON")).toBe("leave-edit");
    expect(polygonKeyAction(drawing, "polygon-close", "BUTTON")).toBe("close");
  });
});
