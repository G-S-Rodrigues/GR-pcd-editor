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

/** Removes and disposes every child of `group`. */
export function clearGroup(group: THREE.Group): void {
  for (const c of [...group.children]) {
    const m = c as THREE.Mesh;
    m.geometry.dispose();
    (m.material as THREE.Material).dispose();
    group.remove(c);
  }
}
