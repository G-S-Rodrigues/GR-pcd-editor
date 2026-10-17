import * as THREE from "three";
import type { AppState } from "../state/app";
import type { Vec3 } from "../state/types";
import { boxCorners } from "../tools/box/model";
import { HANDLE_CROSS_PX, boxHandles } from "../tools/box/handles";
import { DRAFT_OUTLINE, draftOutline } from "../tools/draft";
import { pxPerUnit } from "../view/pointsize";
import { rightVector, upVector } from "../view/camera";
import { planeAnchors } from "./interact";

const mat = (hex: number) => new THREE.LineBasicMaterial({ color: hex, depthTest: false });
const COL = { handle: 0xff9f1c, ring: 0x6ec1ff, poly: 0x7be07b, plane: 0xc77dff, seed: 0xff4d6d };

/** Overlay for the editing tools: box wireframe and handles, polygon outline, protection planes, cluster seed. */
export function createToolsOverlay(scene: THREE.Scene) {
  const group = new THREE.Group();
  group.renderOrder = 9;
  scene.add(group);

  const lines = (pts: Vec3[], pairs: [number, number][], colour: number, origin: Vec3) => {
    const a = new Float32Array(pairs.length * 6);
    pairs.forEach(([i, j], k) => {
      for (let c = 0; c < 3; c++) {
        a[k * 6 + c] = pts[i][c] - origin[c];
        a[k * 6 + 3 + c] = pts[j][c] - origin[c];
      }
    });
    const g = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(a, 3));
    const l = new THREE.LineSegments(g, mat(colour));
    l.renderOrder = 9;
    l.frustumCulled = false;
    group.add(l);
  };
  /** Heavier outline: WebGL lines are 1 px, so the shape is drawn three times, half a pixel apart across the view. */
  const heavy = (pts: Vec3[], pairs: [number, number][], colour: number, origin: Vec3, s: AppState, viewH: number) => {
    const u = 0.6 / pxPerUnit(s.camera, Math.max(viewH, 1));
    const r = rightVector(s.camera);
    const up = upVector(s.camera);
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]] as const) {
      const o: Vec3 = [
        origin[0] - u * (r[0] * dx + up[0] * dy),
        origin[1] - u * (r[1] * dx + up[1] * dy),
        origin[2] - u * (r[2] * dx + up[2] * dy),
      ];
      lines(pts, pairs, colour, o);
    }
  };
  const clear = () => {
    for (const c of [...group.children]) {
      (c as THREE.LineSegments).geometry.dispose();
      ((c as THREE.LineSegments).material as THREE.Material).dispose();
      group.remove(c);
    }
  };

  return {
    update(s: AppState, origin: Vec3, viewH = 720): void {
      clear();
      if (!s.session || s.compare !== "edited") return;
      const t = s.tools;
      const cz = s.camera.target[2];
      const outline = draftOutline(s).colour;

      if (s.tool === "box") {
        const c = boxCorners(t.box);
        const pairs: [number, number][] = [];
        for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) if (!(i & bit)) pairs.push([i, i | bit]);
        heavy(c, pairs, outline, origin, s, viewH);
        for (const hd of boxHandles(t.box, s.camera, s.gizmo.local, viewH)) {
          if (hd.ring) {
            const r = hd.ring;
            lines(r, r.map((_, i): [number, number] => [i, (i + 1) % r.length]), COL.ring, origin);
          } else {
            const tip: Vec3 = hd.anchor;
            const base: Vec3 = hd.cls === "translate" ? t.box.center : hd.anchor;
            const k = hd.cls === "translate" ? 0 : 0.5;
            heavy([base, tip], [[0, 1]], COL.handle, origin, s, viewH);
            // a small cross marks the handle's hit point
            const d = (HANDLE_CROSS_PX / pxPerUnit(s.camera, Math.max(viewH, 1))) * (1 + k);
            lines(
              [[tip[0] - d, tip[1], tip[2]], [tip[0] + d, tip[1], tip[2]], [tip[0], tip[1] - d, tip[2]], [tip[0], tip[1] + d, tip[2]], [tip[0], tip[1], tip[2] - d], [tip[0], tip[1], tip[2] + d]],
              [[0, 1], [2, 3], [4, 5]],
              COL.handle,
              origin,
            );
          }
        }
      }

      if (s.tool === "polygon" && t.polygon.vertices.length > 0) {
        const v = t.polygon.vertices.map((p): Vec3 => [p[0], p[1], cz]);
        const pairs: [number, number][] = v.slice(1).map((_, i) => [i, i + 1]);
        if (t.polygon.phase === "closed" && v.length > 2) pairs.push([v.length - 1, 0]);
        if (s.draft) heavy(v, pairs, DRAFT_OUTLINE, origin, s, viewH);
        else lines(v, pairs, COL.poly, origin);
      }

      const b = s.session.active_bounds;
      if (b) {
        for (const a of planeAnchors(s)) {
          const z = a.anchor[2];
          const q: Vec3[] = [[b.min[0], b.min[1], z], [b.max[0], b.min[1], z], [b.max[0], b.max[1], z], [b.min[0], b.max[1], z]];
          lines(q, [[0, 1], [1, 2], [2, 3], [3, 0]], COL.plane, origin);
        }
      }

      if (s.tool === "cluster" && t.cluster.seed) {
        const p = t.cluster.seed.point;
        const d = Math.max(s.camera.distance * 0.02, 1e-9);
        lines(
          [[p[0] - d, p[1], p[2]], [p[0] + d, p[1], p[2]], [p[0], p[1] - d, p[2]], [p[0], p[1] + d, p[2]], [p[0], p[1], p[2] - d], [p[0], p[1], p[2] + d]],
          [[0, 1], [2, 3], [4, 5]],
          COL.seed,
          origin,
        );
      }
    },
  };
}
