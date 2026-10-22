import * as THREE from "three";
import type { AppState } from "../state/app";
import type { Vec3 } from "../state/types";
import { boxCorners } from "../tools/box/model";
import { HANDLE_CROSS_PX } from "../tools/box/handles";
import { bandOverlaySpec } from "../inspector/bandgizmo";
import { boxOverlaySpec } from "../tools/box/overlay";
import { DRAFT_OUTLINE, draftOutline } from "../tools/draft";
import { pxPerUnit } from "../view/pointsize";
import { clearGroup, drawHeavy, drawLines, drawThick, drawTriangles } from "./lines3d";

const BAND_OPACITY = 0.12;
/** Half-length of the vertex crosses of a polygon in edit mode, in pixels (the pointer pick radius is 10). */
const POLY_EDIT_CROSS_PX = 8;
const COL = { handle: 0xff9f1c, poly: 0x7be07b, plane: 0xc77dff /* = PALETTE.slab */, seed: 0xff4d6d };

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
        const spec = boxOverlaySpec(t.box, s.camera, s.boxHover, viewH);
        for (const a of spec.arrows) {
          drawThick(group, [a.base, a.headBase], [[0, 1]], a.colour, origin, s, viewH, a.width);
          drawTriangles(group, [[a.tip, a.barbs[0], a.barbs[1]]], a.colour, origin);
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

      // the protection band (22-3): fill, outlines, 14b z arrows, tilt rings on headless shafts; empty while "Show band" is off
      const band = bandOverlaySpec(s, viewH);
      const quads = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
      for (const f of band.fills) {
        const pos = new Float32Array(quads.length * 18);
        quads.forEach((q, k) => {
          [0, 1, 2, 0, 2, 3].forEach((ci, j) => {
            for (let c = 0; c < 3; c++) pos[k * 18 + j * 3 + c] = f.corners[q[ci]][c] - origin[c];
          });
        });
        const geo = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(pos, 3));
        const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: COL.plane, transparent: true, opacity: BAND_OPACITY, side: THREE.DoubleSide, depthTest: false, depthWrite: false }));
        mesh.renderOrder = 8;
        mesh.frustumCulled = false;
        group.add(mesh);
      }
      for (const o of band.outlines) lines(o.corners, [[0, 1], [1, 2], [2, 3], [3, 0]], COL.plane, origin);
      for (const sh of band.shafts) drawThick(group, [sh.base, sh.tip], [[0, 1]], sh.colour, origin, s, viewH, sh.width);
      for (const a of band.arrows) {
        drawThick(group, [a.base, a.headBase], [[0, 1]], a.colour, origin, s, viewH, a.width);
        drawTriangles(group, [[a.tip, a.barbs[0], a.barbs[1]]], a.colour, origin);
      }
      for (const r of band.rings) {
        drawThick(group, r.pts, r.pts.map((_, i): [number, number] => [i, (i + 1) % r.pts.length]), r.colour, origin, s, viewH, r.width);
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
