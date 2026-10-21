import type { BoxTool, PrismTool, ThinTool } from "../../orchestration/tooltypes";
import type { RegionKind } from "../cluster/model";

export type ThinMethod = "duplicates" | "voxel";
export const DEFAULT_VOXEL_EDGE = 0.05;

export interface ThinModel {
  method: ThinMethod;
  /** Duplicates: 0 is exact coordinate duplicates; above 0 a point with an earlier point within this distance. */
  distance: number;
  /** Voxel grid: the cube edge in the file unit. */
  edge: number;
  region: RegionKind;
  excludeProtected: boolean;
}

export const defaultThin = (): ThinModel => ({ method: "duplicates", distance: 0, edge: DEFAULT_VOXEL_EDGE, region: "none", excludeProtected: true });

type Edit = { ok: boolean; model: ThinModel; error?: string };

export function setThinMethod(m: ThinModel, method: ThinMethod): Edit {
  if (method !== "duplicates" && method !== "voxel") return { ok: false, model: m, error: "Method must be Duplicates or Voxel grid" };
  return { ok: true, model: method === m.method ? m : { ...m, method } };
}

export function setThinDistance(m: ThinModel, v: number): Edit {
  if (!Number.isFinite(v) || v < 0) return { ok: false, model: m, error: "Distance must be a finite number, 0 or above" };
  return { ok: true, model: v === m.distance ? m : { ...m, distance: v } };
}

export function setThinEdge(m: ThinModel, v: number): Edit {
  if (!Number.isFinite(v) || v <= 0) return { ok: false, model: m, error: "Voxel edge must be a finite number above 0" };
  return { ok: true, model: v === m.edge ? m : { ...m, edge: v } };
}

export function toThinTool(m: ThinModel, box: BoxTool | null, prism: PrismTool | null): ThinTool | null {
  const region = m.region === "box" ? box : m.region === "prism" ? prism : null;
  if (m.method === "duplicates") {
    if (!Number.isFinite(m.distance) || m.distance < 0) return null;
  } else if (!Number.isFinite(m.edge) || m.edge <= 0) return null;
  return { type: "thin", method: m.method, distance: m.distance, edge: m.edge, region, exclude_protected: m.excludeProtected };
}

/** What the Thin tool selects, in plain words. The keeper rules (O2, O3, O10) are part of the text. */
export function thinSummary(m: ThinModel): string {
  const keep = "The point with the lowest index (first in the file) is kept and the others are selected; only points the tool may select (scope, region, Exclude protected) count as copies.";
  if (m.method === "voxel") return `Selects every point but one in each ${m.edge} cube. ${keep} Then Delete to subsample; Undo brings them back.`;
  if (m.distance === 0) return `Selects exact duplicates (identical coordinates). ${keep}`;
  return `Selects a point when an earlier point lies within ${m.distance}. In a chain of points spaced that far apart, every point after the first is selected (chains collapse). ${keep}`;
}
