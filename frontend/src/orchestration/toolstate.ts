import type { AppState } from "../state/app";
import type { ToolKind } from "../state/types";
import { discardEnabled } from "../tools/preview";
import { emptyPolygon, setEditing } from "../tools/polygon/model";

/** Arming a tool (or pressing the armed one again to disarm): Cluster waits for its seed click at once; any change drops the old seed. */
export function armTool(st: AppState, t: ToolKind): AppState {
  return {
    ...st,
    tool: t,
    interaction: t === "cluster" ? "pick-seed" : "orbit",
    liveFirst: (st.session?.selection.count ?? 0) === 0,
    // switching tools also leaves the polygon's edit mode
    tools: { ...st.tools, polygon: setEditing(st.tools.polygon, false), cluster: { ...st.tools.cluster, seed: null } },
  };
}

/** Clear selection also disarms the tool: no armed button, no seed, no polygon, orbit works again; the next shape is a first selection. */
export function disarmed(st: AppState): AppState {
  return {
    ...st,
    tool: "none",
    interaction: "orbit",
    liveFirst: true,
    tools: { ...st.tools, polygon: emptyPolygon(), cluster: { ...st.tools.cluster, seed: null } },
    // the detected list stays; the chosen plane goes with the selection
    planes: { ...st.planes, chosen: null, chosenRow: null, rowNote: null },
  };
}

/**
 * Esc and a successful Delete (R22-1): `disarmed`, except that a closed polygon survives unless the Polygon tool itself is armed,
 * because Cluster, Sparse, Plane and Thin use it as their prism region (before 22-1 only a Polygon-tool Delete blanked it).
 */
export function disarmedKeepingRegion(st: AppState): AppState {
  const d = disarmed(st);
  return st.tool === "polygon" ? d : { ...d, tools: { ...d.tools, polygon: st.tools.polygon } };
}

export type EscTarget = "drag" | "polygon" | "pick" | "layer" | "overlay" | "draft" | "tool";
/** What lives outside the store: the event target, drags held in closures, overlays drawn in the DOM. */
export interface EscInput {
  /** Escape typed in a text entry (`escapeInField`, keys.ts): the field's own Escape wins. */
  field: boolean;
  /** An arrow, ring or handle drag (tools.dragging()), a filter box in use (filterUi.interacting), a timeline marker drag. */
  dragging: boolean;
  /** The help overlay or an open <dialog> (22-5 adds its popovers here). */
  overlay: boolean;
}
/** What one Esc is for, most specific first; "tool" (disarm) only when nothing else is pending. */
export function escTarget(st: AppState, x: EscInput): EscTarget | null {
  if (x.field) return null;
  if (x.dragging) return "drag";
  if (st.tools.polygon.phase === "drawing" || st.tools.polygon.editing) return "polygon";
  if (st.interaction !== "orbit") return "pick";
  if (st.layerUi.editing !== null) return "layer";
  if (x.overlay || st.timeline.highlight !== null) return "overlay";
  if (discardEnabled(st)) return "draft";
  return st.tool !== "none" ? "tool" : null;
}
