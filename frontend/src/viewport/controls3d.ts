import { pickPoint } from "../pick/ray";
import { editAllowed } from "../compare/model";
import { resolveSeed, spacingEstimate } from "../pick/resolve";
import { type AppState, addNotice } from "../state/app";
import type { Store } from "../state/store";
import { orbit, pan, togglePerspective, zoom } from "../view/camera";
import { keyEditBox } from "../tools/box/keyedit";
import { CLICK_SLOP_PX, type ToolInteraction } from "./interact";
import { fitBounds } from "../view/fit";
import { pickPivot } from "../view/pivot";
import { classifyKey, presetForKey } from "../ui/keys";
import { applyPreset } from "../view/presets";

const ORBIT_RAD_PER_PX = 0.005;

/** Mouse and keyboard navigation: left orbit, middle/right/Shift pan, wheel zoom, 1-6 presets, P, F. */
export function attachControls(
  canvas: HTMLCanvasElement,
  store: Store<AppState>,
  size: () => { w: number; h: number },
  tools?: ToolInteraction,
  onSeedPicked?: () => void,
  onPointPicked?: (kind: "floor", point: [number, number, number]) => void,
): () => void {
  // `tool`: the press went to a tool handle or the box body, so the camera ignores its moves
  let drag: { x: number; y: number; startX: number; startY: number; pan: boolean; tool: boolean } | null = null;

  const onDown = (e: PointerEvent) => {
    canvas.setPointerCapture(e.pointerId);
    const tool = tools?.pointerDown(e) ?? false; // a handle or the box body is being dragged: the camera stays put
    drag = {
      tool,
      x: e.clientX,
      y: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      pan: e.button === 1 || e.button === 2 || e.shiftKey,
    };
  };
  const onMove = (e: PointerEvent) => {
    if (tools?.pointerMove(e)) return;
    if (!drag) {
      const h = tools?.hover(e) ?? null;
      canvas.style.cursor = h?.cursor ?? "";
      if ((h?.id ?? null) !== store.get().boxHover) store.update((st) => ({ ...st, boxHover: h?.id ?? null }));
      return;
    }
    if (drag.tool) return;
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
    if (tools?.pointerUp()) {
      drag = null;
      return;
    }
    if (!drag) return;
    // a press the tools took but did not drag (an unmoved press on the box body) is still a click for click-to-centre
    if (drag.tool && !tools?.takeClick()) {
      drag = null;
      return;
    }
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
    if ((s.interaction !== "pick-pivot" && s.interaction !== "pick-seed" && s.interaction !== "pick-floor") || !s.render) return;
    const allowed = editAllowed(s.compare);
    if (!allowed.ok) {
      addNotice(store, "warn", "pick_refused", allowed.reason);
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const hit = pickPoint(s.render, s.camera, size(), px, py, 8);
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
      if (s.interaction === "pick-floor") {
        store.set({ interaction: "orbit" });
        onPointPicked?.("floor", seed.point);
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

  /** The box keys act only with the Box tool armed on the edited view, and not while a drag or rectangle is under way. */
  const boxKeysLive = () => {
    const s = store.get();
    return s.tool === "box" && !!s.session && s.compare === "edited" && s.interaction === "orbit" && !s.rect && !drag;
  };
  const onKey = (e: KeyboardEvent) => {
    const id = classifyKey({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey, target: (e.target as HTMLElement | null)?.tagName ?? "", boxTool: boxKeysLive() });
    if (!id) return;
    const s = store.get();
    if (id === "box-nudge" || id === "box-grow" || id === "box-turn") {
      const box = keyEditBox(s.tools.box, e.key, { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey }, s.camera, s.gizmo);
      if (box) {
        e.preventDefault();
        store.update((st) => ({ ...st, tools: { ...st.tools, box } }));
        tools?.changed();
      }
      return;
    }
    const preset = presetForKey(e.key);
    if (preset && id.startsWith("view-")) {
      store.set({ camera: applyPreset(s.camera, preset) });
    } else if (id === "perspective") {
      store.set({ camera: togglePerspective(s.camera) });
    } else if (id === "fit" && s.session?.active_bounds) {
      const { w, h } = size();
      store.set({ camera: fitBounds(s.camera, s.session.active_bounds, w / Math.max(h, 1)) });
    } else if (id === "fit-selection") {
      const bb = s.candidate?.bounds;
      if (bb) {
        const { w, h } = size();
        store.set({ camera: fitBounds(s.camera, bb, w / Math.max(h, 1)) });
      }
    } else if (id === "cancel" && s.interaction !== "orbit") {
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

