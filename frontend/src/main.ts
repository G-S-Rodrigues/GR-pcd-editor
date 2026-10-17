import * as THREE from "three";

const canvas = document.getElementById("viewport") as HTMLCanvasElement;
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);

const count = 300;
const positions = new Float32Array(count * 3);
for (let i = 0; i < positions.length; i++) {
  positions[i] = (Math.random() - 0.5) * 1.8;
}
const geometry = new THREE.BufferGeometry();
geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
scene.add(
  new THREE.Points(geometry, new THREE.PointsMaterial({ size: 0.02 })),
);

let renderer: THREE.WebGLRenderer | null = null;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
} catch {
  renderer = null;
}

function resize(): void {
  if (!renderer) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  const aspect = w / Math.max(h, 1);
  camera.left = -aspect;
  camera.right = aspect;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
}

window.addEventListener("resize", resize);
resize();
