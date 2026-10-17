import { type Quat, rotate } from "../math/quat";
import { add, cross, dot, normalize, scale } from "../math/vec";
import type { Vec3 } from "../state/types";
import { type Camera } from "./camera";
import { fromBasisLookUp } from "./basis";
import { PRESETS, PRESET_ORDER, type PresetName, applyPreset } from "./presets";

/**
 * Orthographic ViewCube maths, DOM free. The cube has side 1 and is centred on the origin; each face is a unit
 * square in its own (tx, ty) frame, the frame the preset camera sees it in (tx = screen right, ty = screen down),
 * so label text is upright exactly when that face is turned to the viewer.
 */
export interface FaceTransform {
  face: PresetName;
  normal: Vec3;
  /** CSS matrix(a, b, c, d, e, f) for a unit-side face centred on the cube centre (e, f in cube units, y down). */
  m: [number, number, number, number, number, number];
  /** Component of the face normal toward the viewer: 1 straight on, 0 edge-on, negative = back side. */
  depth: number;
  facing: boolean;
}
export interface CubeHit {
  /** One face (face click), two (edge) or three (corner); the first is the face under the pointer. */
  faces: PresetName[];
}
/** Fraction of a face, from each side, that counts as an edge or corner. */
export const EDGE_BAND = 0.15;
const FACING_EPS = 1e-6;

const normalOf = (f: PresetName): Vec3 => scale([...PRESETS[f].look] as Vec3, -1);
const tangentX = (f: PresetName): Vec3 => normalize(cross([...PRESETS[f].look] as Vec3, [...PRESETS[f].up] as Vec3));
const tangentY = (f: PresetName): Vec3 => scale([...PRESETS[f].up] as Vec3, -1);

function frame(o: Quat) {
  return { r: rotate(o, [1, 0, 0]), u: rotate(o, [0, 1, 0]), b: rotate(o, [0, 0, 1]) };
}

export function cubeTransform(o: Quat): FaceTransform[] {
  const { r, u, b } = frame(o);
  return PRESET_ORDER.map((face) => {
    const n = normalOf(face);
    const tx = tangentX(face);
    const ty = tangentY(face);
    const depth = dot(n, b);
    return {
      face,
      normal: n,
      m: [dot(tx, r), -dot(tx, u), dot(ty, r), -dot(ty, u), 0.5 * dot(n, r), -0.5 * dot(n, u)],
      depth,
      facing: depth > FACING_EPS,
    };
  });
}

export function faceForDirection(n: Vec3): PresetName | null {
  for (const f of PRESET_ORDER) {
    const v = normalOf(f);
    if (Math.hypot(n[0] - v[0], n[1] - v[1], n[2] - v[2]) < 1e-6) return f;
  }
  return null;
}

/** `x`, `y` are cube units from the cube centre (+x right, +y down). */
export function hitFace(o: Quat, x: number, y: number): CubeHit | null {
  const faces = cubeTransform(o)
    .filter((f) => f.facing)
    .sort((p, q) => q.depth - p.depth);
  for (const f of faces) {
    const [a, b, c, d, e, g] = f.m;
    const det = a * d - b * c;
    if (Math.abs(det) < 1e-9) continue;
    const u = (d * (x - e) - c * (y - g)) / det;
    const v = (-b * (x - e) + a * (y - g)) / det;
    if (Math.abs(u) > 0.5 + 1e-12 || Math.abs(v) > 0.5 + 1e-12) continue;
    const hit: PresetName[] = [f.face];
    const edge = (t: number, axis: Vec3) => {
      if (Math.abs(t) <= 0.5 - EDGE_BAND) return;
      const nb = faceForDirection(scale(axis, Math.sign(t)));
      if (nb) hit.push(nb);
    };
    edge(u, tangentX(f.face));
    edge(v, tangentY(f.face));
    return { faces: hit };
  }
  return null;
}

/** Face click = the preset; edge and corner clicks look at the cube diagonally (orthographic, Z up). */
export function snapCamera(c: Camera, hit: CubeHit): Camera {
  if (hit.faces.length === 1) return applyPreset(c, hit.faces[0]);
  let sum: Vec3 = [0, 0, 0];
  for (const f of hit.faces) sum = add(sum, normalOf(f));
  return { ...c, orientation: fromBasisLookUp(scale(normalize(sum), -1), [0, 0, 1]), ortho: true };
}

/** World axes as seen by the camera: x right, y down, depth toward the viewer (all of a unit vector). */
export function axisTriad(o: Quat): { axis: "x" | "y" | "z"; x: number; y: number; depth: number }[] {
  const { r, u, b } = frame(o);
  return (
    [
      ["x", [1, 0, 0]],
      ["y", [0, 1, 0]],
      ["z", [0, 0, 1]],
    ] as const
  ).map(([axis, v]) => ({ axis, x: dot(v as Vec3, r), y: -dot(v as Vec3, u), depth: dot(v as Vec3, b) }));
}
