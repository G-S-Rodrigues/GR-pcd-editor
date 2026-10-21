import type * as THREE from "three";
import { RAMP_STOPS } from "../colour/ramps";

const f5 = (v: number): string => v.toFixed(5);

/** GLSL `distRamp(t)`: the Distance stops from the shared table, piecewise linear, t clamped to 0..1. */
export function distanceGlslRamp(): string {
  const stops = RAMP_STOPS.distance;
  const vec = (c: readonly number[]) => `vec3(${f5(c[0])}, ${f5(c[1])}, ${f5(c[2])})`;
  const n = stops.length - 1;
  const lines = stops.slice(0, n).map((a, i) => `  if (x < ${f5(i + 1)}) return mix(${vec(a)}, ${vec(stops[i + 1])}, x - ${f5(i)});`);
  return `vec3 distRamp(float t) {\n  float x = clamp(t, 0.0, 1.0) * ${f5(n)};\n${lines.join("\n")}\n  return ${vec(stops[n])};\n}`;
}

/** Adds the per-vertex distance colour to three's points vertex shader; `ovr` 1 keeps the colour baked on the CPU. */
export function patchDistanceVertex(src: string): string {
  const marker = "#include <project_vertex>";
  if (!src.includes(marker) || !src.includes("void main() {")) throw new Error("points vertex shader has no project_vertex chunk");
  const head = `attribute float ovr;\nuniform float uNear;\nuniform float uFar;\nuniform float uMode;\n${distanceGlslRamp()}\n`;
  const body = `${marker}
  if (uMode > 0.5 && ovr < 0.5) {
    float t = (length(mvPosition.xyz) - uNear) / max(uFar - uNear, 1e-9);
    vColor.rgb = distRamp(t);
  }`;
  return src.replace("void main() {", `${head}void main() {`).replace(marker, body);
}

export interface DistanceUniforms {
  uNear: { value: number };
  uFar: { value: number };
  /** 1 while the Distance mode is active, 0 otherwise (the baked colours show). */
  uMode: { value: number };
}
export const distanceUniforms = (): DistanceUniforms => ({ uNear: { value: 0 }, uFar: { value: 1 }, uMode: { value: 0 } });

/** Makes a vertex-coloured points material draw the Distance ramp while `uniforms.uMode` is 1. One program serves every mode. */
export function useDistanceShader(material: THREE.PointsMaterial, uniforms: DistanceUniforms): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = patchDistanceVertex(shader.vertexShader);
  };
}
