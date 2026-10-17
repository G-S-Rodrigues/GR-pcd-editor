import { pickPoint } from "../pick/ray";
import { pickAllowed, resolveSeed, spacingEstimate } from "../pick/resolve";
import { type AppState, addNotice } from "../state/app";
import type { Store } from "../state/store";
import { orbit, pan, togglePerspective, zoom } from "../view/camera";
import type { ToolInteraction } from "./interact";
import { fitBounds } from "../view/fit";
import { pickPivot } from "../view/pivot";
import { PRESET_ORDER, applyPreset } from "../view/presets";

const ORBIT_RAD_PER_PX = 0.005;
const CLICK_SLOP_PX = 4;

/** Mouse and keyboard navigation: left orbit, middle/right/Shift pan, wheel zoom, 1-6 presets, P, F. */
export function attachControls(
  canvas: HTMLCanvasElement,
  store: Store<AppState>,
  size: () => { w: number; h: number },
  tools?: ToolInteraction,
  onSeedPicked?: () => void,
): () => void {
  let drag: { x: number; y: number; startX: number; startY: number; pan: boolean } | null = null;

  const onDown = (e: PointerEvent) => {
    canvas.setPointerCapture(e.pointerId);
    if (tools?.pointerDown(e)) return; // a handle is being dragged: the camera stays put
    drag = {
      x: e.clientX,
      y: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      pan: e.button === 1 || e.button === 2 || e.shiftKey,
    };
  };
  const onMove = (e: PointerEvent) => {
    if (tools?.pointerMove(e)) return;
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    const cam = store.get().camera;
    store.set({
      camera: drag.pan
        ? pan(cam, dx, dy, size().h)
        : orbit(cam, -dx * ORBIT_RAD_PER_PX, -dy * ORBIT_RAD_PER_PX),
    });
  };
  const onUp = (e: PointerEvent) => {
    if (tools?.pointerUp()) return;
    if (!drag) return;
    const moved = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
    const wasPan = drag.pan;
    drag = null;
    if (moved <= CLICK_SLOP_PX && !wasPan && e.button === 0) void onClick(e);
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    store.set({ camera: zoom(store.get().camera, Math.exp(e.deltaY * 0.001)) });
  };

  async function onClick(e: PointerEvent) {
    const s = store.get();
    if (tools?.click(e)) return;
    if ((s.interaction !== "pick-pivot" && s.interaction !== "pick-seed") || !s.render) return;
    const allowed = pickAllowed(s.renderMode);
    if (!allowed.ok) {
      addNotice(store, "warn", "pick_refused", allowed.reason);
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const hit = pickPoint(s.render, s.camera, size(), px, py);
    if (!hit) {
      addNotice(store, "info", "no_point", "No point near the click; try again closer to a point");
      return;
    }
    const r = s.render;
    const local: [number, number, number] = [
      r.coords[3 * hit.index],
      r.coords[3 * hit.index + 1],
      r.coords[3 * hit.index + 2],
    ];
    try {
      const seed = await resolveSeed({
        local,
        origin: r.origin,
        spacing: spacingEstimate(s.session?.active_bounds ?? null, r.count),
      });
      if (!seed.ok) {
        addNotice(store, "info", "no_point", "No point near the click; try again closer to a point");
        return;
      }
      if (s.interaction === "pick-seed") {
        store.update((st) => ({
          ...st,
          interaction: "orbit",
          tools: { ...st.tools, cluster: { ...st.tools.cluster, seed: { id: seed.id, point: seed.point } } },
        }));
        onSeedPicked?.();
        return;
      }
      store.set({
        camera: pickPivot(store.get().camera, { id: seed.id, point: seed.point }),
        interaction: "orbit",
      });
    } catch (err) {
      addNotice(store, "error", "pick_failed", err instanceof Error ? err.message : "Pick failed");
    }
  }

  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const s = store.get();
    const idx = Number(e.key) - 1;
    if (idx >= 0 && idx < PRESET_ORDER.length) {
      store.set({ camera: applyPreset(s.camera, PRESET_ORDER[idx]) });
    } else if (e.key === "p" || e.key === "P") {
      store.set({ camera: togglePerspective(s.camera) });
    } else if ((e.key === "f" || e.key === "F") && s.session?.active_bounds) {
      const { w, h } = size();
      store.set({ camera: fitBounds(s.camera, s.session.active_bounds, w / Math.max(h, 1)) });
    } else if (e.key === "Escape" && s.interaction !== "orbit") {
      store.set({ interaction: "orbit" });
    }
  };

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  window.addEventListener("keydown", onKey);
  return () => {
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerup", onUp);
    canvas.removeEventListener("wheel", onWheel);
    window.removeEventListener("keydown", onKey);
  };
}

