import type { KeyId } from "../../ui/keys";
import type { PolygonState } from "./model";

export type PolygonKeyAction = "close" | "cancel-drawing" | "leave-edit" | "remove-vertex";

/**
 * What a documented key does to the polygon, or null when it is not the polygon's. Delete stays Apply. `target` is the
 * tag of the focused element: Enter on a focused button activates that button (the pencil itself toggles the mode), so
 * it does not also leave edit mode.
 */
export function polygonKeyAction(s: PolygonState, id: KeyId | null, target = ""): PolygonKeyAction | null {
  if (id === "polygon-close") return s.phase === "drawing" ? "close" : s.editing && target !== "BUTTON" ? "leave-edit" : null;
  if (id === "cancel") return s.phase === "drawing" ? "cancel-drawing" : s.editing ? "leave-edit" : null;
  if (id === "polygon-remove-vertex") return s.editing ? "remove-vertex" : null;
  return null;
}

/** The numbered hint under the Polygon buttons, and whether "Draw polygon" is highlighted (until a polygon is started). */
export function polygonHint(s: PolygonState): { text: string; accentDraw: boolean } {
  if (s.phase === "drawing") {
    const n = s.vertices.length;
    return { text: `Drawing: ${n} ${n === 1 ? "vertex" : "vertices"}. Click to add, Enter to close, Esc to cancel.`, accentDraw: false };
  }
  if (s.phase === "closed") {
    return {
      text: s.editing
        ? "Edit mode: drag a vertex, click an edge to add a vertex, Backspace over a vertex (or a double click on it) removes it. Enter or Esc leaves edit mode."
        : "Polygon closed. Drag a vertex, press the pencil to add or remove vertices, or edit them numerically.",
      accentDraw: false,
    };
  }
  return { text: "1 Press Draw polygon. 2 Click points in the top view. 3 Press Enter or Close polygon.", accentDraw: true };
}
