import type { Candidate, Protection } from "../state/types";
import { type CompareMode, editAllowed } from "../compare/model";

export type OpMode = "inherit" | "add_local" | "override";
export interface Interval {
  min: number;
  max: number;
}
export interface ProtectionModel {
  global: { enabled: boolean; min: number; max: number };
  mode: OpMode;
  local: Interval | null;
  ack: boolean;
}

export const PROTECTION_COPY =
  "Height protection is a coordinate slab, not a semantic floor: it can protect low objects that fall inside the slab, and there are no ramps.";

export const emptyProtection = (): ProtectionModel => ({
  global: { enabled: false, min: 0, max: 0 },
  mode: "inherit",
  local: null,
  ack: false,
});

export const protectionFromState = (p: Protection): ProtectionModel => ({
  global: { enabled: p.global.enabled, min: p.global.min ?? 0, max: p.global.max ?? 0 },
  mode: p.operation.mode,
  local: p.operation.local ? { ...p.operation.local } : null,
  ack: p.operation.acknowledge_override,
});

export interface ProtectionEdit {
  ok: boolean;
  model: ProtectionModel;
  error?: string;
}

const validInterval = (min: number, max: number) => Number.isFinite(min) && Number.isFinite(max) && min <= max;

export function setGlobal(m: ProtectionModel, patch: Partial<ProtectionModel["global"]>): ProtectionEdit {
  const g = { ...m.global, ...patch };
  if (g.enabled && !validInterval(g.min, g.max)) {
    return { ok: false, model: m, error: "Protection needs finite numbers with min not above max" };
  }
  return { ok: true, model: { ...m, global: g } };
}
export function setLocal(m: ProtectionModel, local: Interval): ProtectionEdit {
  if (!validInterval(local.min, local.max)) {
    return { ok: false, model: m, error: "Local protection needs finite numbers with min not above max" };
  }
  return { ok: true, model: { ...m, local: { ...local } } };
}
export const setOperationMode = (m: ProtectionModel, mode: OpMode): ProtectionModel => ({
  ...m,
  mode,
  ack: mode === "override" ? m.ack : false,
});
export const acknowledge = (m: ProtectionModel, ack: boolean): ProtectionModel => ({ ...m, ack });
/** Operation protection belongs to one operation: after an apply it goes back to inherit. */
export const resetOperation = (m: ProtectionModel): ProtectionModel => ({
  ...m,
  mode: "inherit",
  local: null,
  ack: false,
});

export type ProtectionBody = {
  global: { enabled: boolean; min: number; max: number };
  operation: { mode: OpMode; local: Interval | null; acknowledge_override: boolean };
};
export type BodyResult =
  | { ok: true; body: ProtectionBody }
  | { ok: false; reason: "ack_required" | "local_required"; message: string };

export function toProtectionBody(m: ProtectionModel): BodyResult {
  if (m.mode !== "inherit" && !m.local) {
    return { ok: false, reason: "local_required", message: "Enter the local protection interval for this operation" };
  }
  if (m.mode === "override" && !m.ack) {
    return {
      ok: false,
      reason: "ack_required",
      message: "Override ignores the global protection; acknowledge this to preview or apply",
    };
  }
  return {
    ok: true,
    body: {
      global: { ...m.global },
      operation: {
        mode: m.mode,
        local: m.mode === "inherit" ? null : m.local,
        acknowledge_override: m.mode === "override" && m.ack,
      },
    },
  };
}

export const retainedText = (c: Candidate | null): string =>
  c ? `${c.protected_retained.toLocaleString("en-US")} selected points will be retained by protection` : "";

export function effectiveText(c: Candidate | null): string {
  const ep = c?.effective_protection as { mode?: string; intervals?: [number, number][] } | null | undefined;
  if (!ep) return "";
  const iv = (ep.intervals ?? []).map(([a, b]) => `[${a}, ${b}]`).join(" and ") || "none";
  return `Effective protection (${ep.mode ?? "inherit"}): Z ${iv}`;
}

/** Drag a height-plane handle by a world Z delta; min never passes max. */
export function dragPlane(
  m: ProtectionModel,
  which: "global" | "local",
  edge: "min" | "max",
  delta: number,
): ProtectionModel {
  const cur = which === "global" ? m.global : m.local;
  if (!cur || !Number.isFinite(delta)) return m;
  const next =
    edge === "max"
      ? { ...cur, max: Math.max(cur.max + delta, cur.min) }
      : { ...cur, min: Math.min(cur.min + delta, cur.max) };
  return which === "global" ? { ...m, global: { ...m.global, ...next } } : { ...m, local: { min: next.min, max: next.max } };
}

/** Message when the current protection settings block Preview/Apply, else null. */
export function protectionBlock(m: ProtectionModel): string | null {
  const r = toProtectionBody(m);
  return r.ok ? null : r.message;
}

export const DEFAULT_FLOOR_T = 0.05;
export type FloorPick = { ok: true; min: number; max: number } | { ok: false; reason: string };
const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** The protection interval around a picked point's Z: z - t .. z + t, rounded to 1e-6. */
export function intervalFromPick(z: number, t: number): FloorPick {
  if (!Number.isFinite(z)) return { ok: false, reason: "The picked point has no usable height" };
  if (!Number.isFinite(t) || t <= 0) return { ok: false, reason: "The floor thickness must be a number above 0" };
  return { ok: true, min: round6(z - t), max: round6(z + t) };
}

/** Floor protection from a picked point; refused in the read-only comparison views. */
export function floorFromPick(compare: CompareMode, z: number, t: number): FloorPick {
  const allowed = editAllowed(compare);
  if (!allowed.ok) return { ok: false, reason: allowed.reason };
  return intervalFromPick(z, t);
}
