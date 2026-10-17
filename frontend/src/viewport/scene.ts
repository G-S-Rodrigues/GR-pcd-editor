import * as THREE from "three";
import { colourize } from "../colour/modes";
import { PALETTE } from "../colour/palette";
import { type AppState } from "../state/app";
import type { Store } from "../state/store";
import { createToolsOverlay } from "./tools3d";
import { FOV_DEG, eyePosition, halfHeight } from "../view/camera";

export interface Viewport {
  size(): { w: number; h: number };
  requestRender(): void;
  dispose(): void;
}

const AXIS_PX = 96;

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
  const scene = new THREE.Scene();
  const points = new THREE.Points(
    new THREE.BufferGeometry(),
    new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true }),
  );
  points.frustumCulled = false;
  scene.add(points);

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

  const axes = new THREE.Scene();
  const axisCam = new THREE.OrthographicCamera(-1.3, 1.3, 1.3, -1.3, -10, 10);
  for (const [dir, colour] of [
    [[1, 0, 0], 0xff5555],
    [[0, 1, 0], 0x55ff55],
    [[0, 0, 1], 0x5599ff],
  ] as const) {
    const g = new THREE.BufferGeometry().setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array([0, 0, 0, ...dir]), 3),
    );
    axes.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: colour })));
  }

  const persp = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.1, 1000);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);

  let pointsFor: AppState["render"] = null;
  let colourKey = "";
  let raf = 0;

  function syncGeometry(s: AppState) {
    const r = s.render;
    if (!r) {
      points.visible = false;
      pointsFor = null;
      return;
    }
    const key = `${s.colour.mode}|${s.session?.session_id}|${s.session?.revision.cloud}|${s.session?.active_bounds?.min[2]}|${s.session?.active_bounds?.max[2]}`;
    if (r !== pointsFor) {
      points.geometry.dispose();
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(r.coords, 3));
      g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(r.count * 3), 3));
      points.geometry = g;
      pointsFor = r;
      colourKey = "";
    }
    if (key !== colourKey) {
      colourKey = key;
      const rgb = colourize(r, {
        mode: s.colour.mode,
        bounds: s.session?.active_bounds ?? null,
        markDeleted: false,
      });
      (points.geometry.getAttribute("color") as THREE.BufferAttribute).set(rgb);
      (points.geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
    }
    points.visible = true;
  }

  function draw() {
    raf = 0;
    const s = store.get();
    syncGeometry(s);
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
    const aspect = w / h;
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
    (points.material as THREE.PointsMaterial).size = s.colour.pointSize;
    pivot.position.set(cam.target[0] - origin[0], cam.target[1] - origin[1], cam.target[2] - origin[2]);
    pivot.scale.setScalar(Math.max(halfHeight(cam) * 0.03, 1e-9));
    pivot.visible = s.session !== null;
    overlay.update(s, origin as [number, number, number]);

    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
    renderer.clear();
    renderer.render(scene, camera);

    axisCam.quaternion.set(...cam.orientation);
    axisCam.position.set(0, 0, 5).applyQuaternion(axisCam.quaternion);
    axisCam.updateMatrixWorld();
    renderer.setScissorTest(true);
    renderer.setScissor(8, 8, AXIS_PX, AXIS_PX);
    renderer.setViewport(8, 8, AXIS_PX, AXIS_PX);
    renderer.clearDepth();
    renderer.render(axes, axisCam);
    renderer.setScissorTest(false);
  }

  const requestRender = () => {
    if (!raf) raf = requestAnimationFrame(draw);
  };
  const unsub = store.subscribe(requestRender);
  const ro = new ResizeObserver(requestRender);
  ro.observe(canvas);
  requestRender();

  return {
    size: () => ({ w: canvas.clientWidth, h: canvas.clientHeight }),
    requestRender,
    dispose() {
      unsub();
      ro.disconnect();
      cancelAnimationFrame(raf);
      renderer.dispose();
    },
  };
}
