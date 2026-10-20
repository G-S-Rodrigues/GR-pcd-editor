import * as THREE from "three";
import type { AppState } from "../state/app";
import type { Vec3 } from "../state/types";
import { boxCorners } from "../tools/box/model";
import { HANDLE_CROSS_PX } from "../tools/box/handles";
import { boxOverlaySpec } from "../tools/box/overlay";
import { DRAFT_OUTLINE, draftOutline } from "../tools/draft";
import { ARROW_PX } from "../filterboxes/plane";
import { rightVector } from "../view/camera";
import { pxPerUnit } from "../view/pointsize";
import { tiltRings } from "../inspector/rings";
import { planeAnchors } from "./interact";
import { clearGroup, drawHeavy, drawLines, drawThick } from "./lines3d";

const BAND_OPACITY = 0.12;
const HEAD_PX = 9;
/** Half-length of the vertex crosses of a polygon in edit mode, in pixels (the pointer pick radius is 10). */
const POLY_EDIT_CROSS_PX = 8;
const COL = { handle: 0xff9f1c, ring: 0x6ec1ff, poly: 0x7be07b, plane: 0xc77dff /* = PALETTE.slab */, seed: 0xff4d6d };

/** Overlay for the editing tools: box wireframe and handles, polygon outline, protection planes, cluster seed. */
export function createToolsOverlay(scene: THREE.Scene) {
  const group = new THREE.Group();
  group.renderOrder = 9;
  scene.add(group);

  const lines = (pts: Vec3[], pairs: [number, number][], colour: number, origin: Vec3) => drawLines(group, pts, pairs, colour, origin);
  const heavy = (pts: Vec3[], pairs: [number, number][], colour: number, origin: Vec3, s: AppState, viewH: number) => drawHeavy(group, pts, pairs, colour, origin, s, viewH);
  const clear = () => clearGroup(group);

  return {
    update(s: AppState, origin: Vec3, viewH = 720, viewW = viewH * 1.5): void {
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
        const spec = boxOverlaySpec(t.box, s.camera, s.gizmo.local, s.boxHover, viewH, viewW);
        for (const a of spec.arrows) {
          const pts: Vec3[] = [a.base, a.tip, a.barbs[0], a.barbs[1]];
          drawThick(group, pts, [[0, 1], [1, 2], [1, 3]], a.colour, origin, s, viewH, a.width);
        }
        for (const r of spec.rings) {
          drawThick(group, r.pts, r.pts.map((_, i): [number, number] => [i, (i + 1) % r.pts.length]), r.colour, origin, s, viewH, r.width);
        }
      }

      if (s.tool === "polygon" && t.polygon.vertices.length > 0) {
        const v = t.polygon.vertices.map((p): Vec3 => [p[0], p[1], cz]);
        const pairs: [number, number][] = v.slice(1).map((_, i) => [i, i + 1]);
        if (t.polygon.phase === "closed" && v.length > 2) pairs.push([v.length - 1, 0]);
        if (s.draft) heavy(v, pairs, DRAFT_OUTLINE, origin, s, viewH);
        else lines(v, pairs, COL.poly, origin);
        if (t.polygon.phase === "closed") {
          // vertex handles: small crosses always (they can be dragged), large ones in edit mode, drawn heavy so they stand out
          const k = (t.polygon.editing ? POLY_EDIT_CROSS_PX : HANDLE_CROSS_PX) / pxPerUnit(s.camera, Math.max(viewH, 1));
          for (const p of v) {
            const cross: Vec3[] = [[p[0] - k, p[1], p[2]], [p[0] + k, p[1], p[2]], [p[0], p[1] - k, p[2]], [p[0], p[1] + k, p[2]]];
            const cp: [number, number][] = [[0, 1], [2, 3]];
            if (t.polygon.editing) heavy(cross, cp, COL.handle, origin, s, viewH);
            else lines(cross, cp, COL.poly, origin);
          }
        }
      }

      const b = s.session.active_bounds;
      if (b) {
        const anchors = planeAnchors(s, viewH);
        // band fill: the slab between each interval's two planes over the footprint (two triangles per face)
        const edge = (which: "global" | "local") => ({ lo: anchors.find((a) => a.key.which === which && a.key.edge === "min"), hi: anchors.find((a) => a.key.which === which && a.key.edge === "max") });
        for (const which of ["global", "local"] as const) {
          const { lo, hi } = edge(which);
          if (!lo || !hi) continue;
          const pts = [...lo.corners, ...hi.corners];
          const quads = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
          const pos = new Float32Array(quads.length * 18);
          quads.forEach((q, k) => {
            [0, 1, 2, 0, 2, 3].forEach((ci, j) => {
              for (let c = 0; c < 3; c++) pos[k * 18 + j * 3 + c] = pts[q[ci]][c] - origin[c];
            });
          });
          const geo = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(pos, 3));
          const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: COL.plane, transparent: true, opacity: BAND_OPACITY, side: THREE.DoubleSide, depthTest: false, depthWrite: false }));
          mesh.renderOrder = 8;
          mesh.frustumCulled = false;
          group.add(mesh);
        }
        for (const a of anchors) {
          lines(a.corners, [[0, 1], [1, 2], [2, 3], [3, 0]], COL.plane, origin);
          // each plane's own arrow, pointing away from the band
          const dir: Vec3 = [a.tip[0] - a.anchor[0], a.tip[1] - a.anchor[1], a.tip[2] - a.anchor[2]];
          const len = Math.hypot(...dir) || 1;
          const h = (HEAD_PX / ARROW_PX) * len;
          const u: Vec3 = [dir[0] / len, dir[1] / len, dir[2] / len];
          const r = rightVector(s.camera);
          const barb = (k: number): Vec3 => [a.tip[0] - u[0] * h + k * r[0] * h * 0.5, a.tip[1] - u[1] * h + k * r[1] * h * 0.5, a.tip[2] - u[2] * h + k * r[2] * h * 0.5];
          heavy([a.anchor, a.tip, barb(1), barb(-1)], [[0, 1], [1, 2], [1, 3]], COL.plane, origin, s, viewH);
        }
      }

      // rotation rings of the tilted slab, same look as the box rings
      for (const ring of tiltRings(s, viewH)) {
        lines(ring.pts, ring.pts.map((_, i): [number, number] => [i, (i + 1) % ring.pts.length]), COL.ring, origin);
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
