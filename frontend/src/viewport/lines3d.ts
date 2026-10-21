import * as THREE from "three";
import type { AppState } from "../state/app";
import type { Vec3 } from "../state/types";
import { rightVector, upVector } from "../view/camera";
import { pxPerUnit } from "../view/pointsize";

/** Line segments between `pairs` of `pts` (file frame; `origin` is subtracted for float precision), added to `group`. */
export function drawLines(group: THREE.Group, pts: Vec3[], pairs: [number, number][], colour: number, origin: Vec3, renderOrder = 9): void {
  const a = new Float32Array(pairs.length * 6);
  pairs.forEach(([i, j], k) => {
    for (let c = 0; c < 3; c++) {
      a[k * 6 + c] = pts[i][c] - origin[c];
      a[k * 6 + 3 + c] = pts[j][c] - origin[c];
    }
  });
  const g = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(a, 3));
  const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: colour, depthTest: false }));
  l.renderOrder = renderOrder;
  l.frustumCulled = false;
  group.add(l);
}

/** Heavier outline: WebGL lines are 1 px, so the shape is drawn three times, half a pixel apart across the view. */
export function drawHeavy(group: THREE.Group, pts: Vec3[], pairs: [number, number][], colour: number, origin: Vec3, s: AppState, viewH: number, renderOrder = 9): void {
  const u = 0.6 / pxPerUnit(s.camera, Math.max(viewH, 1));
  const r = rightVector(s.camera);
  const up = upVector(s.camera);
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]] as const) {
    const o: Vec3 = [
      origin[0] - u * (r[0] * dx + up[0] * dy),
      origin[1] - u * (r[1] * dx + up[1] * dy),
      origin[2] - u * (r[2] * dx + up[2] * dy),
    ];
    drawLines(group, pts, pairs, colour, o, renderOrder);
  }
}

/** A line of the given pixel width: the shape is repeated every 0.75 px across the view (right, then up), so any width reads solid. */
export function drawThick(group: THREE.Group, pts: Vec3[], pairs: [number, number][], colour: number, origin: Vec3, s: AppState, viewH: number, widthPx: number, renderOrder = 9): void {
  if (widthPx <= 1.05) {
    drawLines(group, pts, pairs, colour, origin, renderOrder);
    return;
  }
  const u = 0.75 / pxPerUnit(s.camera, Math.max(viewH, 1));
  const r = rightVector(s.camera);
  const up = upVector(s.camera);
  const n = Math.ceil((widthPx - 1) / 0.75);
  const offsets: [number, number][] = [[0, 0]];
  for (let i = 1; i <= n; i++) offsets.push([i, 0], [0, i]);
  for (const [dx, dy] of offsets) {
    const o: Vec3 = [origin[0] - u * (r[0] * dx + up[0] * dy), origin[1] - u * (r[1] * dx + up[1] * dy), origin[2] - u * (r[2] * dx + up[2] * dy)];
    drawLines(group, pts, pairs, colour, o, renderOrder);
  }
}

/** A filled triangle (depth test off, both faces), added to `group`. */
export function drawTriangles(group: THREE.Group, tris: [Vec3, Vec3, Vec3][], colour: number, origin: Vec3, renderOrder = 9): void {
  const a = new Float32Array(tris.length * 9);
  tris.forEach((t, k) => t.forEach((p, j) => { for (let c = 0; c < 3; c++) a[k * 9 + j * 3 + c] = p[c] - origin[c]; }));
  const g = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(a, 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: colour, side: THREE.DoubleSide, depthTest: false, depthWrite: false }));
  m.renderOrder = renderOrder;
  m.frustumCulled = false;
  group.add(m);
}

/** Removes and disposes every child of `group`. */
export function clearGroup(group: THREE.Group): void {
  for (const c of [...group.children]) {
    const m = c as THREE.Mesh;
    m.geometry.dispose();
    (m.material as THREE.Material).dispose();
    group.remove(c);
  }
}
