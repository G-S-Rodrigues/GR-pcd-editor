import type { Candidate, Scope, Vec3 } from "../../state/types";
import type { BoxTool } from "../../orchestration/tooltypes";
import type { PrismTool } from "../../orchestration/tooltypes";

export type RegionKind = "none" | "box" | "prism";
export interface ClusterModel {
  seed: { id: number; point: Vec3 } | null;
  radius: number;
  region: RegionKind;
  excludeProtected: boolean;
  /** null = no limit (memory is still protected by the backend budget check). */
  maxPoints: number | null;
  scope: Scope;
}

export const CLUSTER_LIMIT_TEXT = "Expansion paused: cluster larger than the limit; not complete";

export const defaultCluster = (): ClusterModel => ({
  seed: null,
  radius: 0.5,
  region: "none",
  excludeProtected: true,
  maxPoints: 2_000_000,
  scope: "displayed",
});

export const setSeed = (m: ClusterModel, seed: ClusterModel["seed"]): ClusterModel => ({ ...m, seed });
export function setRadius(m: ClusterModel, radius: number): { ok: boolean; model: ClusterModel; error?: string } {
  if (!Number.isFinite(radius) || radius <= 0) {
    return { ok: false, model: m, error: "Radius must be a finite number greater than 0" };
  }
  return { ok: true, model: { ...m, radius } };
}

export const regionOptions = (box: BoxTool | null, prism: PrismTool | null): RegionKind[] => {
  const out: RegionKind[] = ["none"];
  if (box) out.push("box");
  if (prism) out.push("prism");
  return out;
};

export function toClusterTool(m: ClusterModel, box: BoxTool | null, prism: PrismTool | null) {
  if (!m.seed || !Number.isFinite(m.radius) || m.radius <= 0) return null;
  const region = m.region === "box" ? box : m.region === "prism" ? prism : null;
  return {
    type: "cluster" as const,
    seed_id: m.seed.id,
    radius: m.radius,
    region,
    exclude_protected: m.excludeProtected,
    max_points: m.maxPoints,
  };
}

/** A limit hit selects the partial cluster; say so and how to go on. Null when the cluster is complete. */
export function clusterLimitText(c: Candidate | null): string | null {
  const cl = c?.cluster as { complete?: boolean; limit?: number | null } | null | undefined;
  if (!cl || cl.complete !== false) return null;
  return `Stopped at ${(cl.limit ?? 0).toLocaleString("en-US")} points; raise Max points or clear the field for no limit`;
}

export const MEMORY_GUARD_TEXT =
  "The server ran short of memory and stopped the search to keep your session. Try a larger radius or a smaller region.";

/** Texts that replace the server message; null keeps the server's own (radius_too_small names the minimum radius). */
export const clusterErrorText = (code: string): string | null =>
  code === "component_limit_reached" ? CLUSTER_LIMIT_TEXT : code === "memory_guard" ? MEMORY_GUARD_TEXT : null;

export function clusterPanel(c: Candidate | null): { label: string; value: string }[] {
  const cl = c?.cluster as
    | { seed_id: number; radius: number; size: number; bounds: { min: number[]; max: number[] } }
    | null
    | undefined;
  if (!c || !cl) return [];
  const f = (v: number[]) => v.map((x) => Math.round(x * 1000) / 1000).join(", ");
  return [
    { label: "Seed", value: String(cl.seed_id) },
    { label: "Radius", value: String(cl.radius) },
    { label: "Size", value: String(cl.size) },
    { label: "Candidates", value: String(c.candidates) },
    { label: "Bounds", value: `${f(cl.bounds.min)} to ${f(cl.bounds.max)}` },
  ];
}
