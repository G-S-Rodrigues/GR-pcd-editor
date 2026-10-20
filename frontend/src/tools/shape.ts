import type { AppState } from "../state/app";
import type { HistoryEntry, StepBox, StepPrism, StepShape, Vec3 } from "../state/types";
import type { RegionKind } from "./cluster/model";
import { boxFromShape } from "./box/model";
import { type PolygonState, emptyPolygon } from "./polygon/model";
import { validatePolygon } from "./polygon/validate";

export const EDIT_SHAPE_UNAVAILABLE = "This step was saved before shapes were stored; centre only";

/** A selection step has no shape: it came from a layer's Select (or Select displayed or Invert). */
export const LAYER_STEP_TITLE = "This step was selected from a layer (or by Select displayed or Invert), so it has no shape to edit";

/** The Edit shape button for a step: whether it works, its accessible name and its tooltip. `n` is the step's 1-based position. */
export function editShapeState(entry: HistoryEntry, n: number): { enabled: boolean; label: string; title: string } {
  const label = `Edit the shape of step ${n}`;
  if (!entry.shape) return { enabled: false, label, title: entry.tool === "selection" ? LAYER_STEP_TITLE : EDIT_SHAPE_UNAVAILABLE };
  return { enabled: true, label, title: `${label}: clears the selection and reopens this step's shape as a live selection; applying it adds a new step` };
}

export type ShapePatch = Pick<AppState, "tool" | "tools" | "interaction" | "liveFirst" | "draft" | "preview" | "candidate">;
export type ShapeResult = { ok: true; patch: ShapePatch } | { ok: false; reason: string };

function closedPolygon(shape: StepPrism, editing: boolean): { ok: true; polygon: PolygonState } | { ok: false; reason: string } {
  const vertices = shape.polygon.map((v) => [v[0], v[1]] as [number, number]);
  const problem = validatePolygon(vertices);
  if (problem) return { ok: false, reason: `The stored polygon is not valid: ${problem}` };
  return { ok: true, polygon: { ...emptyPolygon(), phase: "closed", vertices, zMin: shape.z_min, zMax: shape.z_max, mode: shape.mode, editing } };
}

/**
 * The store patch that reopens a step's shape: the tool is armed and seeded, a live first selection starts. `centre` is the
 * step's centre, used only to draw a cluster's seed cross (the server keeps the seed's id, not its position).
 */
export function shapeToPatch(shape: StepShape, st: AppState, centre: Vec3 | null): ShapeResult {
  const base = { interaction: "orbit" as const, liveFirst: true, draft: false, preview: null, candidate: null };
  if (shape.type === "box") {
    return { ok: true, patch: { ...base, tool: "box", tools: { ...st.tools, box: boxFromShape(shape) } } };
  }
  if (shape.type === "prism") {
    const p = closedPolygon(shape, true);
    if (!p.ok) return p;
    return { ok: true, patch: { ...base, tool: "polygon", tools: { ...st.tools, polygon: p.polygon } } };
  }
  // cluster and sparse carry an optional region: a box or a polygon the search was limited to
  let tools = st.tools;
  let region: RegionKind = "none";
  if (shape.region) {
    if (shape.region.type === "box") {
      region = "box";
      tools = { ...tools, box: boxFromShape(shape.region as StepBox) };
    } else {
      const p = closedPolygon(shape.region, false);
      if (!p.ok) return p;
      region = "prism";
      tools = { ...tools, polygon: p.polygon };
    }
  }
  if (shape.type === "cluster") {
    const cluster = {
      ...tools.cluster,
      seed: { id: shape.seed_id, point: centre ?? ([0, 0, 0] as Vec3) },
      radius: shape.radius,
      maxPoints: shape.max_points,
      excludeProtected: shape.exclude_protected,
      region,
    };
    return { ok: true, patch: { ...base, tool: "cluster", tools: { ...tools, cluster } } };
  }
  const sparse = { radius: shape.radius, minNeighbours: shape.min_neighbours, excludeProtected: shape.exclude_protected, region };
  return { ok: true, patch: { ...base, tool: "sparse", tools: { ...tools, sparse } } };
}
