import { nearest } from "../api/session";
import { toWorld } from "../render/origin";
import type { Bounds, RenderMode, Vec3 } from "../state/types";

export type SeedResult =
  | { ok: true; id: number; point: Vec3 }
  | { ok: false; code: "no_point" };

/** Mean point spacing guessed from the bounding box and the rendered sample count. */
export function spacingEstimate(bounds: Bounds | null, count: number): number {
  if (!bounds || count < 1) return 1;
  const dims = [0, 1, 2]
    .map((i) => bounds.max[i] - bounds.min[i])
    .filter((d) => d > 1e-9);
  if (dims.length === 0) return 1;
  const volume = dims.reduce((a, b) => a * b, 1);
  return (volume / count) ** (1 / dims.length);
}

/** Resolves a picked rendered point to a source ID and its exact coordinates via the backend. */
export async function resolveSeed(p: {
  local: Vec3;
  origin: Vec3;
  spacing: number;
}): Promise<SeedResult> {
  const world = toWorld(p.local, p.origin);
  const radius = Math.max(2 * p.spacing, 1e-6);
  const r = await nearest(world, radius);
  if (r.id === null || r.id === undefined || !r.point) return { ok: false, code: "no_point" };
  return { ok: true, id: r.id, point: r.point };
}

export function pickAllowed(mode: RenderMode): { ok: true } | { ok: false; reason: string } {
  return mode === "edited"
    ? { ok: true }
    : { ok: false, reason: "Return to the edited view to pick points" };
}
