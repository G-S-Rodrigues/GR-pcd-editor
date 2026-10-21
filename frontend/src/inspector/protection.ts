import type { Bounds, Candidate, Protection } from "../state/types";
import { type CompareMode, editAllowed } from "../compare/model";
import { MAX_TILT_DEG, type Tilt, isLevel, levelTilt, normalOf } from "./tilt";

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
  /** One slab orientation for the global and the local interval. */
  tilt: Tilt;
}

export const PROTECTION_COPY =
  "Height protection is a coordinate slab, not a semantic floor: it can protect low objects that fall inside the slab, and there are no ramps.";

export const emptyProtection = (): ProtectionModel => ({
  global: { enabled: false, min: 0, max: 0 },
  mode: "inherit",
  local: null,
  ack: false,
  tilt: levelTilt(),
});

export const protectionFromState = (p: Protection): ProtectionModel => ({
  global: { enabled: p.global.enabled, min: p.global.min ?? 0, max: p.global.max ?? 0 },
  mode: p.operation.mode,
  local: p.operation.local ? { ...p.operation.local } : null,
  ack: p.operation.acknowledge_override,
  tilt: p.tilt ? { rx: p.tilt.rx_deg, ry: p.tilt.ry_deg, pivot: [p.tilt.pivot[0], p.tilt.pivot[1]] } : levelTilt(),
});

const clampDeg = (v: number) => Math.min(MAX_TILT_DEG, Math.max(-MAX_TILT_DEG, v));

/**
 * Sets the tilt angles (typed values, validated to +-60). The pivot is the given active-bounds XY centre on the
 * first non-zero tilt and stays until Level; angles back at 0 on both levels the slab.
 */
export function setTilt(m: ProtectionModel, patch: { rx?: number; ry?: number }, centre: [number, number]): ProtectionEdit {
  const rx = patch.rx ?? m.tilt.rx;
  const ry = patch.ry ?? m.tilt.ry;
  if (![rx, ry, ...centre].every(Number.isFinite)) return { ok: false, model: m, error: "The tilt must be a number of degrees" };
  if (Math.abs(rx) > MAX_TILT_DEG || Math.abs(ry) > MAX_TILT_DEG) {
    return { ok: false, model: m, error: `The slab tilt is limited to +-${MAX_TILT_DEG} degrees` };
  }
  if (rx === 0 && ry === 0) return { ok: true, model: { ...m, tilt: levelTilt() } };
  const pivot: [number, number] = isLevel(m.tilt) ? [centre[0], centre[1]] : m.tilt.pivot;
  return { ok: true, model: { ...m, tilt: { rx, ry, pivot } } };
}

const DEG = 180 / Math.PI;
const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Use as protection band: the global band becomes the slab about a detected plane. The angles come from the plane normal
 * (rx = -asin(ny), ry = atan2(nx, nz), the `normalOf` convention), the pivot is the given active-bounds XY centre, and
 * the interval is [s0 - t, s0 + t] with s0 the slab coordinate of the plane. It is refused when either angle is beyond 60 degrees.
 */
export function bandFromPlane(m: ProtectionModel, plane: { normal: [number, number, number]; d: number; thickness: number }, centre: [number, number]): ProtectionEdit {
  const [nx, ny, nz] = plane.normal;
  if (![nx, ny, nz, plane.d, plane.thickness, ...centre].every(Number.isFinite) || !(plane.thickness > 0)) {
    return { ok: false, model: m, error: "This plane has no usable numbers" };
  }
  const rx = -Math.asin(Math.max(-1, Math.min(1, ny))) * DEG;
  const ry = Math.atan2(nx, nz) * DEG;
  if (Math.abs(rx) > MAX_TILT_DEG || Math.abs(ry) > MAX_TILT_DEG) {
    return { ok: false, model: m, error: `This plane needs a tilt of rx ${r1(rx)}, ry ${r1(ry)} degrees; the protection band allows at most ${MAX_TILT_DEG} on each` };
  }
  const level = rx === 0 && ry === 0;
  const tilt: Tilt = level ? levelTilt() : { rx, ry, pivot: [centre[0], centre[1]] };
  const n = normalOf(tilt);
  const s0 = level ? plane.d : plane.d - n[0] * centre[0] - n[1] * centre[1];
  const t = plane.thickness;
  return { ok: true, model: { ...m, tilt, global: { enabled: true, min: s0 - t, max: s0 + t } } };
}

/** O11: the confirm text when a band is already enabled (it is replaced; protection is not a timeline step), else null. */
export function bandReplaceText(m: ProtectionModel): string | null {
  if (!m.global.enabled) return null;
  const t = isLevel(m.tilt) ? "level" : `tilt rx ${r1(m.tilt.rx)}, ry ${r1(m.tilt.ry)} degrees`;
  return `Replace the protection band ${m.global.min} to ${m.global.max} (${t}) with this Detected plane?`;
}

/** Level button: angles 0 and the pivot cleared; the intervals are untouched. */
export const levelled = (m: ProtectionModel): ProtectionModel => ({ ...m, tilt: levelTilt() });

/** A ring drag: add `deltaDeg` to rx (X ring) or ry (Y ring), clamped to +-60. */
export function rotateSlab(m: ProtectionModel, which: "x" | "y", deltaDeg: number, centre: [number, number]): ProtectionModel {
  if (!Number.isFinite(deltaDeg)) return m;
  const r = setTilt(
    m,
    which === "x" ? { rx: clampDeg(m.tilt.rx + deltaDeg) } : { ry: clampDeg(m.tilt.ry + deltaDeg) },
    centre,
  );
  return r.ok ? r.model : m;
}

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

/**
 * One click for ghosts inside the protected slab: this operation overrides the global protection with a local
 * interval entirely above the cloud (cloud max Z + 1 .. + 2), so nothing is protected, and the override is
 * acknowledged. It is exactly what typing such a dummy interval does; the operation settings reset after Apply.
 */
export function alsoDeleteKept(m: ProtectionModel, cloud: Bounds | null): ProtectionEdit {
  const top = cloud?.max[2];
  if (top === undefined || !Number.isFinite(top)) {
    return { ok: false, model: m, error: "The cloud has no usable height range; set the override interval by hand" };
  }
  return { ok: true, model: { ...m, mode: "override", local: { min: top + 1, max: top + 2 }, ack: true } };
}

export type ProtectionBody = {
  global: { enabled: boolean; min: number; max: number };
  operation: { mode: OpMode; local: Interval | null; acknowledge_override: boolean };
  /** Sent only when the slab is tilted, so a level body is exactly what it was before tilting existed. */
  tilt?: { rx_deg: number; ry_deg: number; pivot: [number, number] };
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
  const body: ProtectionBody = {
    global: { ...m.global },
    operation: {
      mode: m.mode,
      local: m.mode === "inherit" ? null : m.local,
      acknowledge_override: m.mode === "override" && m.ack,
    },
  };
  if (!isLevel(m.tilt)) body.tilt = { rx_deg: m.tilt.rx, ry_deg: m.tilt.ry, pivot: [m.tilt.pivot[0], m.tilt.pivot[1]] };
  return { ok: true, body };
}

export const retainedText = (c: Candidate | null): string =>
  c ? `${c.protected_retained.toLocaleString("en-US")} selected points will be retained by protection` : "";

export function effectiveText(c: Candidate | null): string {
  const ep = c?.effective_protection as { mode?: string; intervals?: [number, number][] } | null | undefined;
  if (!ep) return "";
  const iv = (ep.intervals ?? []).map(([a, b]) => `[${a}, ${b}]`).join(" and ") || "none";
  const layers = c?.protected_by_layers ?? 0;
  const plus = layers > 0 ? `, plus protected layers (${layers.toLocaleString("en-US")} ${layers === 1 ? "point" : "points"})` : "";
  return `Effective protection (${ep.mode ?? "inherit"}): Z ${iv}${plus}`;
}

/** Drag a slab plane by a distance along the slab normal (world Z at level); min never passes max. */
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
