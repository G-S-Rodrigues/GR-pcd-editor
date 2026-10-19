import { type Vec2, validatePolygon } from "./validate";

export type PolygonPhase = "idle" | "drawing" | "closed";
export const Z_UNLIMITED = 1e9;

export const POLYGON_DEPTH_NOTE =
  "Scissors/polygon selections include points through the view depth unless Z limits are enabled";

export interface PolygonState {
  phase: PolygonPhase;
  vertices: Vec2[];
  /** Closed polygon to restore when a redraw is cancelled. */
  previous: Vec2[] | null;
  zMin: number;
  zMax: number;
  mode: "inside" | "outside";
  /** Edit mode (pencil): vertex handles show, an edge click inserts a vertex, Backspace or a double tap removes one. Closed polygons only. */
  editing: boolean;
}

export interface PolygonResult {
  ok: boolean;
  state: PolygonState;
  message?: string;
  /** Vertices of a rejected edit, for drawing the offending shape in red; never sent. */
  invalidPreview?: Vec2[];
}

export const emptyPolygon = (): PolygonState => ({
  phase: "idle",
  vertices: [],
  previous: null,
  zMin: -Z_UNLIMITED,
  zMax: Z_UNLIMITED,
  mode: "inside",
  editing: false,
});

/** Entering the polygon tool switches to the top view. */
export const enterTool = () => ({ view: "top" as const });

export function startDrawing(s: PolygonState): PolygonState {
  return { ...s, phase: "drawing", previous: s.phase === "closed" ? s.vertices : s.previous, vertices: [], editing: false };
}
export function addVertex(s: PolygonState, p: Vec2): PolygonState {
  return s.phase === "drawing" ? { ...s, vertices: [...s.vertices, p] } : s;
}
export const POLYGON_NEEDS_THREE = "Needs at least 3 points that are not in a line";
export const Z_ORDER_MESSAGE = "Invalid: Z min above Z max";

/** A Z limit as the field shows it: the sentinels read "Unlimited". */
export const zText = (v: number, fmt: (n: number) => string): string => (Math.abs(v) >= Z_UNLIMITED ? "Unlimited" : fmt(v));

/** Why a closed polygon cannot be used, or null. */
export function polygonProblem(s: PolygonState): string | null {
  if (s.zMin > s.zMax) return Z_ORDER_MESSAGE;
  return null;
}

export function closePolygon(s: PolygonState): PolygonResult {
  let message = validatePolygon(s.vertices);
  if (message && (s.vertices.length < 3 || message === "Polygon has zero area")) message = POLYGON_NEEDS_THREE;
  if (message) return { ok: false, state: s, message };
  return { ok: true, state: { ...s, phase: "closed", previous: null } };
}
export function cancelDrawing(s: PolygonState): PolygonState {
  if (s.phase !== "drawing") return s;
  return s.previous
    ? { ...s, phase: "closed", vertices: s.previous, previous: null }
    : { ...s, phase: "idle", vertices: [], previous: null };
}

export function setZ(s: PolygonState, zMin: number, zMax: number): PolygonResult {
  if (!Number.isFinite(zMin) || !Number.isFinite(zMax)) return { ok: false, state: s, message: "Z limits must be finite" };
  if (zMin > zMax) return { ok: false, state: s, message: Z_ORDER_MESSAGE };
  return { ok: true, state: { ...s, zMin, zMax } };
}

/** Z handle drag: moves one limit by a world delta and never crosses the other. */
export function dragZ(s: PolygonState, which: "zMin" | "zMax", delta: number): PolygonState {
  if (!Number.isFinite(delta)) return s;
  return which === "zMax"
    ? { ...s, zMax: Math.max(s.zMax + delta, s.zMin) }
    : { ...s, zMin: Math.min(s.zMin + delta, s.zMax) };
}

export function moveVertex(s: PolygonState, index: number, p: Vec2): PolygonResult {
  if (s.phase !== "closed" || index < 0 || index >= s.vertices.length) {
    return { ok: false, state: s, message: "Close the polygon before editing its vertices" };
  }
  const vertices = s.vertices.map((v, i) => (i === index ? p : v)) as Vec2[];
  const message = validatePolygon(vertices);
  if (message) return { ok: false, state: s, message, invalidPreview: vertices };
  return { ok: true, state: { ...s, vertices } };
}
export const setVertexNumeric = moveVertex;

export const MIN_VERTICES = 3;

/** Insert a vertex after the first vertex of edge `edgeIndex` (edge i runs from vertex i to vertex i+1, the last back to 0). */
export function insertVertex(s: PolygonState, edgeIndex: number, p: Vec2): PolygonResult {
  if (s.phase !== "closed" || !Number.isInteger(edgeIndex) || edgeIndex < 0 || edgeIndex >= s.vertices.length) {
    return { ok: false, state: s, message: "Close the polygon before editing its vertices" };
  }
  const vertices = [...s.vertices.slice(0, edgeIndex + 1), p, ...s.vertices.slice(edgeIndex + 1)] as Vec2[];
  const message = validatePolygon(vertices);
  if (message) return { ok: false, state: s, message, invalidPreview: vertices };
  return { ok: true, state: { ...s, vertices } };
}

/** Remove one vertex; a polygon keeps at least three and the result must still be valid. */
export function removeVertex(s: PolygonState, index: number): PolygonResult {
  if (s.phase !== "closed" || !Number.isInteger(index) || index < 0 || index >= s.vertices.length) {
    return { ok: false, state: s, message: "Close the polygon before editing its vertices" };
  }
  if (s.vertices.length <= MIN_VERTICES) return { ok: false, state: s, message: "A polygon needs at least 3 vertices" };
  const vertices = s.vertices.filter((_, i) => i !== index) as Vec2[];
  const message = validatePolygon(vertices);
  if (message) return { ok: false, state: s, message, invalidPreview: vertices };
  return { ok: true, state: { ...s, vertices } };
}

/** Turns the edit mode on or off; only a closed polygon can be in it. */
export const setEditing = (s: PolygonState, on: boolean): PolygonState => (s.editing === (on && s.phase === "closed") ? s : { ...s, editing: on && s.phase === "closed" });

export function toPrismTool(s: PolygonState) {
  if (s.phase !== "closed" || validatePolygon(s.vertices) || s.zMin > s.zMax) return null;
  return {
    type: "prism" as const,
    polygon: s.vertices.map((v) => [v[0], v[1]] as Vec2),
    z_min: s.zMin,
    z_max: s.zMax,
    mode: s.mode,
  };
}
