import * as THREE from "three";
import { AXIS_COLOUR, filterPlanes } from "../filterboxes/plane";
import type { AppState } from "../state/app";
import type { Vec3 } from "../state/types";
import { rightVector, upVector } from "../view/camera";
import { pxPerUnit } from "../view/pointsize";
import { clearGroup, drawHeavy, drawLines } from "./lines3d";

const FILL_OPACITY = 0.18;
const HEAD_PX = 9;

/**
 * Overlay of the display-filter planes and their arrows (edited view only). Fill under the tool overlay, arrows above it.
 */
export function createFilterPlanesOverlay(scene: THREE.Scene) {
  const group = new THREE.Group();
  group.renderOrder = 8;
  scene.add(group);

  return {
    update(s: AppState, origin: Vec3, viewH = 720): void {
      clearGroup(group);
      const planes = filterPlanes(s, viewH);
      const ppu = pxPerUnit(s.camera, Math.max(viewH, 1));
      for (const p of planes) {
        const colour = AXIS_COLOUR[p.axis];
        const pos = new Float32Array(18);
        [0, 1, 2, 0, 2, 3].forEach((ci, k) => {
          for (let c = 0; c < 3; c++) pos[k * 3 + c] = p.corners[ci][c] - origin[c];
        });
        const geo = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(pos, 3));
        const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: FILL_OPACITY, side: THREE.DoubleSide, depthTest: false, depthWrite: false }));
        mesh.renderOrder = 8;
        mesh.frustumCulled = false;
        group.add(mesh);
        drawLines(group, p.corners, [[0, 1], [1, 2], [2, 3], [3, 0]], colour, origin, 8);
        // arrow: shaft plus a head made of two barbs, perpendicular to the shaft on screen
        const dir: Vec3 = [p.tip[0] - p.base[0], p.tip[1] - p.base[1], p.tip[2] - p.base[2]];
        const len = Math.hypot(...dir) || 1;
        const u: Vec3 = [dir[0] / len, dir[1] / len, dir[2] / len];
        const r = rightVector(s.camera);
        const up = upVector(s.camera);
        const dr = Math.abs(u[0] * r[0] + u[1] * r[1] + u[2] * r[2]);
        const side = dr < 0.9 ? r : up;
        const h = HEAD_PX / ppu;
        const barb = (sign: number): Vec3 => [
          p.tip[0] - u[0] * h + sign * side[0] * h * 0.5,
          p.tip[1] - u[1] * h + sign * side[1] * h * 0.5,
          p.tip[2] - u[2] * h + sign * side[2] * h * 0.5,
        ];
        drawHeavy(group, [p.base, p.tip, barb(1), barb(-1)], [[0, 1], [1, 2], [1, 3]], colour, origin, s, viewH, 11);
      }
    },
  };
}
