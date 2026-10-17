import * as THREE from "three";
import { colourize } from "../colour/modes";
import { clampOpacity, overlayStyle } from "../compare/model";
import { splitRects } from "../compare/split";
import { LOD_INTERACT, createLodGate, lodIndex } from "../render/lod";
import type { RenderData } from "../render/parse";
import { PALETTE } from "../colour/palette";
import { type AppState } from "../state/app";
import type { Store } from "../state/store";
import { createToolsOverlay } from "./tools3d";
import { FOV_DEG, eyePosition, halfHeight } from "../view/camera";
import { slicePlanes } from "../view/slice";

export interface Viewport {
  size(): { w: number; h: number };
  /** Points the main layer draws right now (the interaction LOD lowers it while the camera moves). */
  drawnCount(): number;
  requestRender(): void;
  dispose(): void;
}


/** WebGL point viewport. Returns null (after showing a notice element) when WebGL is unavailable. */
export function createViewport(
  canvas: HTMLCanvasElement,
  store: Store<AppState>,
  onUnavailable: (reason: string) => void,
): Viewport | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  } catch (e) {
    onUnavailable(e instanceof Error ? e.message : "WebGL could not start");
    return null;
  }
  renderer.setClearColor(0x15181d, 1);
  renderer.localClippingEnabled = true;
  const scene = new THREE.Scene();
  const points = new THREE.Points(
    new THREE.BufferGeometry(),
    new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true }),
  );
  points.frustumCulled = false;
  scene.add(points);
  // second render: deleted points (overlay, one flat translucent colour) or the edited cloud (split, right pane)
  const delStyle = overlayStyle(undefined);
  const deletedPts = new THREE.Points(
    new THREE.BufferGeometry(),
    new THREE.PointsMaterial({
      size: 2,
      sizeAttenuation: false,
      color: new THREE.Color(...delStyle.colour),
      transparent: true,
      opacity: delStyle.opacity,
      depthWrite: false,
    }),
  );
  deletedPts.frustumCulled = false;
  deletedPts.visible = false;
  scene.add(deletedPts);
  const rightPts = new THREE.Points(
    new THREE.BufferGeometry(),
    new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true }),
  );
  rightPts.frustumCulled = false;
  rightPts.visible = false;
  scene.add(rightPts);

  // "Show kept points": render-only layer of the protected-selected points, drawn larger
  const keptPts = new THREE.Points(
    new THREE.BufferGeometry(),
    new THREE.PointsMaterial({ size: 6, sizeAttenuation: false, color: new THREE.Color(...PALETTE.protected) }),
  );
  keptPts.frustumCulled = false;
  keptPts.visible = false;
  keptPts.renderOrder = 5;
  scene.add(keptPts);
  let keptFor: RenderData | null = null;
  function syncKept(s: AppState) {
    const d = s.render;
    const on = s.showKept && d !== null && s.compare !== "split";
    if (!on || !d) {
      keptPts.visible = false;
      keptFor = null;
      return;
    }
    if (keptFor !== d) {
      const idx: number[] = [];
      for (let i = 0; i < d.count; i++) if (d.flags[i] & 2) idx.push(i);
      const pos = new Float32Array(idx.length * 3);
      idx.forEach((i, k) => pos.set(d.coords.subarray(3 * i, 3 * i + 3), 3 * k));
      keptPts.geometry.dispose();
      keptPts.geometry = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(pos, 3));
      keptFor = d;
    }
    (keptPts.material as THREE.PointsMaterial).size = Math.max(6, s.colour.pointSize * 2.5);
    keptPts.visible = true;
  }

  const pivot = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, -1, 0, 0, 1]), 3),
    ),
    new THREE.LineBasicMaterial({ color: new THREE.Color(...PALETTE.pivot), depthTest: false }),
  );
  pivot.renderOrder = 10;
  scene.add(pivot);

  const overlay = createToolsOverlay(scene);

  const persp = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.1, 1000);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);

  let raf = 0;
  // interaction LOD: while the camera moves, a layer draws a stride subsample (plus its flagged points); the full
  // index returns LOD_IDLE_MS after the last camera change
  const gate = createLodGate(() => requestRender());
  const lodCache = new WeakMap<RenderData, Uint32Array | null>();
  const lodFor = (d: RenderData): Uint32Array | null => {
    if (!lodCache.has(d)) lodCache.set(d, lodIndex(d.count, LOD_INTERACT, d.flags));
    return lodCache.get(d) ?? null;
  };
  const layerFor = new Map<THREE.Points, { data: RenderData | null; key: string; lod: boolean }>();
  function syncLayer(obj: THREE.Points, data: RenderData | null, s: AppState, colours: boolean) {
    if (!data) {
      obj.visible = false;
      layerFor.delete(obj);
      return;
    }
    const st = layerFor.get(obj) ?? { data: null, key: "", lod: false };
    if (st.data !== data) {
      obj.geometry.dispose();
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(data.coords, 3));
      if (colours) g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(data.count * 3), 3));
      obj.geometry = g;
      st.data = data;
      st.key = "";
      st.lod = false;
    }
    if (gate.active() !== st.lod) {
      const idx = gate.active() ? lodFor(data) : null;
      obj.geometry.setIndex(idx ? new THREE.BufferAttribute(idx, 1) : null);
      st.lod = gate.active();
    }
    if (colours) {
      const key = `${s.colour.mode}|${s.session?.session_id}|${s.session?.revision.cloud}|${s.session?.active_bounds?.min[2]}|${s.session?.active_bounds?.max[2]}`;
      if (key !== st.key) {
        st.key = key;
        const attr = obj.geometry.getAttribute("color") as THREE.BufferAttribute;
        attr.set(colourize(data, { mode: s.colour.mode, bounds: s.session?.active_bounds ?? null, markDeleted: false }));
        attr.needsUpdate = true;
      }
    }
    layerFor.set(obj, st);
    obj.visible = true;
  }
  function syncGeometry(s: AppState) {
    syncLayer(points, s.render, s, true);
    syncLayer(deletedPts, s.compare === "overlay" ? s.render2 : null, s, false);
    syncLayer(rightPts, s.compare === "split" ? s.render2 : null, s, true);
    const o = s.render?.origin ?? [0, 0, 0];
    for (const [obj, d] of [[deletedPts, s.render2], [rightPts, s.render2]] as const) {
      if (d) obj.position.set(d.origin[0] - o[0], d.origin[1] - o[1], d.origin[2] - o[2]);
    }
    const mat = deletedPts.material as THREE.PointsMaterial;
    mat.opacity = clampOpacity(s.overlayOpacity);
    mat.size = s.colour.pointSize;
    (rightPts.material as THREE.PointsMaterial).size = s.colour.pointSize;
  }

  // slice view: render-only clipping of every point layer (selection, filters and counts are untouched)
  const clipPlanes = [new THREE.Plane(), new THREE.Plane()];
  let clipOn = false;
  function syncClip(s: AppState) {
    const sp = slicePlanes(s.slice, (s.render?.origin ?? [0, 0, 0]) as [number, number, number]);
    sp.forEach((p, i) => clipPlanes[i].set(new THREE.Vector3(...p.normal), p.constant));
    const on = sp.length > 0;
    for (const m of [points.material, deletedPts.material, rightPts.material, keptPts.material] as THREE.PointsMaterial[]) {
      m.clippingPlanes = on ? clipPlanes : null;
      if (on !== clipOn) m.needsUpdate = true;
    }
    clipOn = on;
  }

  function draw() {
    raf = 0;
    const s = store.get();
    syncGeometry(s);
    syncKept(s);
    syncClip(s);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    renderer.setPixelRatio(1);
    const origin = s.render?.origin ?? [0, 0, 0];
    const cam = s.camera;
    const eye = eyePosition(cam);
    const radius = s.session?.bounds
      ? Math.hypot(
          s.session.bounds.max[0] - s.session.bounds.min[0],
          s.session.bounds.max[1] - s.session.bounds.min[1],
          s.session.bounds.max[2] - s.session.bounds.min[2],
        ) / 2
      : 1;
    const span = 2 * radius + cam.distance;
    const cameraFor = (aspect: number): THREE.Camera => {
      let camera: THREE.Camera;
      if (cam.ortho) {
        const hh = halfHeight(cam);
        ortho.left = -hh * aspect;
        ortho.right = hh * aspect;
        ortho.top = hh;
        ortho.bottom = -hh;
        ortho.near = -span;
        ortho.far = span + cam.distance;
        ortho.updateProjectionMatrix();
        camera = ortho;
      } else {
        persp.aspect = aspect;
        persp.near = Math.max(cam.distance * 1e-3, 1e-6);
        persp.far = span * 2 + cam.distance;
        persp.updateProjectionMatrix();
        camera = persp;
      }
      camera.position.set(eye[0] - origin[0], eye[1] - origin[1], eye[2] - origin[2]);
      camera.quaternion.set(...cam.orientation);
      camera.updateMatrixWorld();
      return camera;
    };
    (points.material as THREE.PointsMaterial).size = s.colour.pointSize;
    pivot.position.set(cam.target[0] - origin[0], cam.target[1] - origin[1], cam.target[2] - origin[2]);
    pivot.scale.setScalar(Math.max(halfHeight(cam) * 0.03, 1e-9));
    pivot.visible = s.session !== null;
    overlay.update(s, origin as [number, number, number], h, w);

    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
    renderer.clear();
    if (s.compare === "split" && s.render2) {
      // one camera state drives both panes: left = original, right = edited
      const [l, r] = splitRects(w, h);
      const aLeft = points.visible;
      const bRight = rightPts.visible;
      renderer.setScissorTest(true);
      for (const [rect, showLeft] of [[l, true], [r, false]] as const) {
        points.visible = showLeft && aLeft;
        rightPts.visible = !showLeft && bRight;
        renderer.setScissor(rect.x, rect.y, rect.w, rect.h);
        renderer.setViewport(rect.x, rect.y, rect.w, rect.h);
        renderer.render(scene, cameraFor(rect.w / Math.max(rect.h, 1)));
      }
      points.visible = aLeft;
      rightPts.visible = bRight;
      renderer.setScissorTest(false);
    } else {
      renderer.render(scene, cameraFor(w / h));
    }
  }

  const requestRender = () => {
    if (!raf) raf = requestAnimationFrame(draw);
  };
  let lastCamera = store.get().camera;
  const unsub = store.subscribe((s) => {
    if (s.camera !== lastCamera) {
      lastCamera = s.camera;
      gate.cameraMoved();
    }
    requestRender();
  });
  const ro = new ResizeObserver(requestRender);
  ro.observe(canvas);
  requestRender();

  return {
    size: () => ({ w: canvas.clientWidth, h: canvas.clientHeight }),
    requestRender,
    drawnCount: () => (points.visible ? (points.geometry.index?.count ?? points.geometry.getAttribute("position")?.count ?? 0) : 0),
    dispose() {
      unsub();
      gate.dispose();
      ro.disconnect();
      cancelAnimationFrame(raf);
      renderer.dispose();
    },
  };
}
