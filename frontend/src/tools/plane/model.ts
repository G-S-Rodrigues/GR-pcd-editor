import type { BoxTool, PrismTool, PlaneTool } from "../../orchestration/tooltypes";
import type { Bounds, Scope, Vec3 } from "../../state/types";
import type { RegionKind } from "../cluster/model";

/** R22-15 defaults (owner 2026-10-23, superseding O7's 0.03 / 30 / 4): distance in the file unit, planes within 5 degrees of level, one plane. The seed is not exposed. */
export const DEFAULT_PLANE_DISTANCE = 0.1;
export const DEFAULT_MAX_TILT = 5;
export const DEFAULT_MAX_PLANES = 1;
/** The server's limits (editing/planes.py MAX_PLANES). */
export const MAX_PLANES_LIMIT = 8;

export interface PlaneModel {
  /** Inlier distance of the detection and half thickness of the selected slab, in the file unit. */
  distance: number;
  maxTilt: number;
  maxPlanes: number;
  region: RegionKind;
  excludeProtected: boolean;
}

export const defaultPlane = (): PlaneModel => ({
  distance: DEFAULT_PLANE_DISTANCE,
  maxTilt: DEFAULT_MAX_TILT,
  maxPlanes: DEFAULT_MAX_PLANES,
  region: "none",
  excludeProtected: true,
});

/** A plane as the detect job returns it: n . p = d with nz >= 0. */
export interface DetectedPlane {
  normal: Vec3;
  d: number;
  count: number;
  rms: number;
  tilt_deg: number;
  z_centre: number | null;
  bounds: Bounds;
}

/** The plane the tool selects: the detected numbers and the slab half thickness. */
export interface ChosenPlane {
  normal: Vec3;
  d: number;
  thickness: number;
}

/** Client-only detection state (O8: not saved in the session). */
export interface PlanesState {
  /** null: never detected in this page; [] means none found. */
  list: DetectedPlane[] | null;
  /** Eligible points the detection ran on (scope, region, protection). */
  eligible: number;
  /** The scope the detection used. */
  scope: Scope | null;
  /** The cloud revision the list belongs to; a different current revision makes the list stale. */
  revision: number | null;
  chosen: ChosenPlane | null;
  chosenRow: number | null;
  busy: boolean;
  progress: number | null;
  message: string | null;
  /** A refusal shown under a row (Use as protection band). */
  rowNote: { row: number; text: string } | null;
}

export const emptyPlanes = (): PlanesState => ({
  list: null,
  eligible: 0,
  scope: null,
  revision: null,
  chosen: null,
  chosenRow: null,
  busy: false,
  progress: null,
  message: null,
  rowNote: null,
});

type Edit = { ok: boolean; model: PlaneModel; error?: string };

export function setPlaneDistance(m: PlaneModel, v: number): Edit {
  if (!Number.isFinite(v) || v <= 0) return { ok: false, model: m, error: "Distance must be a finite number above 0" };
  return { ok: true, model: v === m.distance ? m : { ...m, distance: v } };
}

export function setMaxTilt(m: PlaneModel, v: number): Edit {
  if (!Number.isFinite(v) || v <= 0 || v > 90) return { ok: false, model: m, error: "Max tilt must be above 0 and at most 90 degrees" };
  return { ok: true, model: v === m.maxTilt ? m : { ...m, maxTilt: v } };
}

export function setMaxPlanes(m: PlaneModel, v: number): Edit {
  if (!Number.isInteger(v) || v < 1 || v > MAX_PLANES_LIMIT) {
    return { ok: false, model: m, error: `Planes must be a whole number from 1 to ${MAX_PLANES_LIMIT}` };
  }
  return { ok: true, model: v === m.maxPlanes ? m : { ...m, maxPlanes: v } };
}

/** The tool request for the chosen plane; null while no plane is chosen. */
export function toPlaneTool(m: PlaneModel, chosen: ChosenPlane | null, box: BoxTool | null, prism: PrismTool | null): PlaneTool | null {
  if (!chosen) return null;
  if (!(Number.isFinite(chosen.thickness) && chosen.thickness > 0) || !Number.isFinite(chosen.d) || !chosen.normal.every(Number.isFinite)) return null;
  const region = m.region === "box" ? box : m.region === "prism" ? prism : null;
  return { type: "plane", normal: [...chosen.normal], d: chosen.d, thickness: chosen.thickness, region, exclude_protected: m.excludeProtected };
}

const fmtN = (n: number) => n.toLocaleString("en-US");

/** What the Planes tool selects, in plain words. */
export function planeSummary(m: PlaneModel): string {
  return `Detect finds up to ${m.maxPlanes} near-horizontal Detected planes (tilt up to ${m.maxTilt} degrees, points within ${m.distance} of the plane) on a sample of the points; choose a row to select the points within that distance of it. Detection changes nothing by itself.`;
}

export interface PlaneRow {
  index: number;
  label: string;
  /** z of the plane at the active-bounds centre. */
  z: string;
  tilt: string;
  count: string;
  rms: string;
}

const r3 = (v: number) => String(Math.round(v * 1e3) / 1e3);

/** The list rows. The labels come from the z order only: the lowest may be a floor, the highest a ceiling. */
export function planeRows(planes: readonly DetectedPlane[], active: Bounds | null): PlaneRow[] {
  const cx = active ? (active.min[0] + active.max[0]) / 2 : 0;
  const cy = active ? (active.min[1] + active.max[1]) / 2 : 0;
  return planes.map((p, i) => {
    const z = p.z_centre ?? (p.normal[2] !== 0 ? (p.d - p.normal[0] * cx - p.normal[1] * cy) / p.normal[2] : Number.NaN);
    const label = i === 0 ? "Lowest (floor?)" : i === planes.length - 1 ? "Highest (ceiling?)" : `Plane ${i + 1}`;
    return { index: i, label, z: r3(z), tilt: `${r3(p.tilt_deg)}`, count: fmtN(p.count), rms: r3(p.rms) };
  });
}

export const NO_PLANE_REASON = "Detect planes and choose one first";

export function chosenFrom(p: DetectedPlane, distance: number): ChosenPlane {
  return { normal: [...p.normal] as Vec3, d: p.d, thickness: distance };
}
