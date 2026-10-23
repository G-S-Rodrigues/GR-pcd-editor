import type { BoxTool, PrismTool, SparseTool } from "../../orchestration/tooltypes";
import type { RegionKind } from "../cluster/model";

/** The server's default: a point with fewer than this many points in its 3 x 3 x 3 cubes is isolated. */
export const DEFAULT_MIN_NEIGHBOURS = 8;

/** R22-15 default Sparse radius, in the file unit. */
export const DEFAULT_SPARSE_RADIUS = 0.4;

export interface SparseModel {
  /** Cube edge in the file unit (default 0.4, R22-15); null (the field cleared) lets the server derive it from the point spacing. */
  radius: number | null;
  minNeighbours: number;
  region: RegionKind;
  excludeProtected: boolean;
}

export const defaultSparse = (): SparseModel => ({ radius: DEFAULT_SPARSE_RADIUS, minNeighbours: DEFAULT_MIN_NEIGHBOURS, region: "none", excludeProtected: true });

type Edit = { ok: boolean; model: SparseModel; error?: string };

export function setSparseRadius(m: SparseModel, radius: number | null): Edit {
  if (radius !== null && (!Number.isFinite(radius) || radius <= 0)) return { ok: false, model: m, error: "Radius must be a finite number above 0, or empty to derive it from the point spacing" };
  return { ok: true, model: radius === m.radius ? m : { ...m, radius } };
}

export function setMinNeighbours(m: SparseModel, n: number): Edit {
  if (!Number.isInteger(n) || n < 1) return { ok: false, model: m, error: "Neighbours must be a whole number of at least 1" };
  return { ok: true, model: n === m.minNeighbours ? m : { ...m, minNeighbours: n } };
}

export function toSparseTool(m: SparseModel, box: BoxTool | null, prism: PrismTool | null): SparseTool | null {
  if (m.radius !== null && (!Number.isFinite(m.radius) || m.radius <= 0)) return null;
  if (!Number.isInteger(m.minNeighbours) || m.minNeighbours < 1) return null;
  const region = m.region === "box" ? box : m.region === "prism" ? prism : null;
  return { type: "sparse", radius: m.radius, min_neighbours: m.minNeighbours, region, exclude_protected: m.excludeProtected };
}

/** What the tool selects, in plain words. */
export function sparseSummary(m: SparseModel): string {
  const around = m.radius === null ? "radius from the point spacing" : `radius ${m.radius}`;
  return `Selects points with fewer than ${m.minNeighbours} points around them (${around}). Walls and floors are dense and stay; isolated points in the open are selected.`;
}
