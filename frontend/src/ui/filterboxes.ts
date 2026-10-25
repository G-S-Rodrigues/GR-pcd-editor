import { beginFilterDrag, cancelFilterDrag, END_ON_DOT, type FilterDrag, moveFilterDrag } from "../filterboxes/drag";
import { BOX_IDS, boxKey, isBoxCollapsed } from "../filterboxes/model";
import { type PlaceState, type Rect, pillRect, placeBoxes } from "../filterboxes/placement";
import { boxTipRects } from "../filterboxes/tips";
import { boxView, nudgeValue, parseBoxInput } from "../filterboxes/view";
import { type Axis, type FilterEdit, type Side, filterSummary, sideValue } from "../inspector/filters";
import { screenRay } from "../pick/screenray";
import { type AppState, addNotice } from "../state/app";
import type { Store } from "../state/store";
import { lookDirection } from "../view/camera";
import { RESET_HUD } from "../view/layout";
import { bandPillShown } from "./bandpill";
import { control } from "./controls";
import { h } from "./dom";
import { iconControl } from "./iconbutton";

export interface BoxActions {
  editSide: (axis: Axis, side: Side, value: number, opts: { live: boolean }) => FilterEdit;
  resetSide: (axis: Axis, side: Side) => FilterEdit;
}

const EXPANDED = { w: 156, h: 28 };
const COLLAPSED = { w: 76, h: 24 };
const AXIS_I: Record<Axis, number> = { x: 0, y: 1, z: 2 };

interface Box {
  axis: Axis;
  side: Side;
  key: string;
  el: HTMLDivElement;
  grip: HTMLDivElement;
  input: HTMLInputElement;
  reset: HTMLButtonElement;
  toggle: HTMLButtonElement;
}

/**
 * The six display-filter boxes over the canvas: a grip (drag along the screen, arrow keys), a typed value, a reset and a
 * collapse button each. Positions come from `placeBoxes`; values go through the filter controller only.
 */
export function buildFilterBoxes(
  layer: HTMLElement,
  canvas: HTMLCanvasElement,
  store: Store<AppState>,
  actions: BoxActions,
): { dragging: () => boolean } {
  const boxes: Box[] = [];
  const setInteracting = (key: string | null) => {
    const cur = store.get().filterUi.interacting;
    if (key === null && cur === null) return;
    store.update((s) => ({ ...s, filterUi: { ...s.filterUi, interacting: key } }));
  };
  const bounds = () => store.get().session?.bounds ?? null;
  const current = (axis: Axis, side: Side) => sideValue(store.get().tools.filters, bounds(), axis, side);
  const toggle = (key: string) =>
    store.update((s) => ({ ...s, filterUi: { ...s.filterUi, collapsed: { ...s.filterUi.collapsed, [key]: !isBoxCollapsed(s.filterUi, key) } } }));

  let drag: { d: FilterDrag; pointer: number; el: HTMLElement } | null = null;
  const ray = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return screenRay(store.get().camera, { w: r.width, h: r.height }, e.clientX - r.left, e.clientY - r.top);
  };
  const endDrag = (apply: boolean, e?: PointerEvent) => {
    if (!drag) return;
    const { d, el, pointer } = drag;
    drag = null;
    try {
      el.releasePointerCapture(pointer);
    } catch {
      /* already released */
    }
    const b = bounds();
    let value = cancelFilterDrag(d);
    if (apply && e && b) {
      const other = current(d.axis, d.side === "min" ? "max" : "min");
      value = moveFilterDrag(d, ray(e), b, other, e.shiftKey) ?? value;
    }
    actions.editSide(d.axis, d.side, value, { live: false });
    setInteracting(null);
  };
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drag) endDrag(false);
  });

  for (const id of BOX_IDS) {
    const { axis, side } = id;
    const key = boxKey(id);
    const A = axis.toUpperCase();
    const fid = `filter-${axis}-${side}`;
    const grip = control("div", { id: `${fid}-grip`, class: "fgrip", role: "slider", tabindex: "0", "aria-label": `${A} ${side} filter`, text: `${A} ${side}` });
    const input = control("input", { id: fid, class: "fin", type: "text", inputmode: "decimal", "aria-label": `${A} ${side} value` });
    const reset = control("button", { id: `${fid}-reset`, class: "frst", "aria-label": `Reset ${A} ${side} filter`, onclick: () => actions.resetSide(axis, side) }, "↺");
    const tog = control("button", { id: `${fid}-toggle`, class: "ftog", "aria-expanded": "false", "aria-label": `${A} ${side} filter box`, onclick: () => toggle(key) }, "–");
    const el = h("div", { class: "fbox", "data-axis": axis, "data-side": side, "data-box": key }, grip, input, reset, tog);
    const box: Box = { axis, side, key, el, grip, input, reset, toggle: tog };
    boxes.push(box);
    layer.append(el);

    const revert = () => {
      input.value = boxView(store.get().tools.filters, bounds(), axis, side, false).valueText;
    };
    input.addEventListener("change", () => {
      const p = parseBoxInput(input.value);
      if (!p.ok) {
        addNotice(store, "warn", "filter_invalid", `${A} ${side} must be a number`);
        return revert();
      }
      const r = actions.editSide(axis, side, p.value, { live: false });
      if (!r.ok) {
        addNotice(store, "warn", "filter_invalid", r.error ?? `${A} ${side} is not valid`);
        revert();
      }
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        revert();
        input.blur();
      }
    });
    input.addEventListener("focus", () => setInteracting(key));
    input.addEventListener("blur", () => setInteracting(null));
    grip.addEventListener("focus", () => setInteracting(key));
    grip.addEventListener("blur", () => !drag && setInteracting(null));
    grip.addEventListener("keydown", (e) => {
      const v = nudgeValue(current(axis, side), bounds(), axis, e.key, e.shiftKey);
      if (v === null) return;
      e.preventDefault();
      actions.editSide(axis, side, v, { live: false });
    });
    grip.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || grip.getAttribute("aria-disabled") === "true" || !bounds()) return;
      const d = beginFilterDrag({ axis, side, value: current(axis, side), ray: ray(e), origin: store.get().camera.target });
      if (!d) return;
      e.preventDefault();
      grip.focus();
      grip.setPointerCapture(e.pointerId);
      drag = { d, pointer: e.pointerId, el: grip };
      setInteracting(key);
    });
    grip.addEventListener("pointermove", (e) => {
      const b = bounds();
      if (!drag || drag.d.axis !== axis || drag.d.side !== side || !b) return;
      const other = current(axis, side === "min" ? "max" : "min");
      const v = moveFilterDrag(drag.d, ray(e), b, other, e.shiftKey);
      if (v !== null) actions.editSide(axis, side, v, { live: true });
    });
    grip.addEventListener("pointerup", (e) => endDrag(true, e));
    grip.addEventListener("pointercancel", () => endDrag(false));
  }

  let place: PlaceState | null = null;
  const sync = (s: AppState) => {
    layer.hidden = s.session === null;
    if (s.session === null) return;
    const b = s.session.bounds;
    const look = lookDirection(s.camera);
    const sizes = (id: string) => (isBoxCollapsed(s.filterUi, id) ? COLLAPSED : EXPANDED);
    const stage = { w: layer.clientWidth, h: layer.clientHeight };
    const lock = new Set<string>(s.filterUi.interacting ? [s.filterUi.interacting] : []);
    // reserved: the band-hidden pill and, while the Box tool is armed, its arrow tips (a chip on a tip would take the press)
    const reserved: Rect[] = [...(bandPillShown(s) ? [pillRect(stage)] : []), ...(s.tool === "box" ? boxTipRects(s.tools.box, s.camera, stage) : [])];
    const placed = placeBoxes(s.camera.orientation, stage, place, sizes, lock, reserved);
    place = placed.state;
    for (const box of boxes) {
      const collapsed = isBoxCollapsed(s.filterUi, box.key);
      const v = boxView(s.tools.filters, b, box.axis, box.side, collapsed);
      box.el.className = v.classes;
      box.el.dataset.active = String(v.active);
      if (document.activeElement !== box.input) box.input.value = v.valueText;
      box.input.disabled = v.disabled;
      box.reset.disabled = v.disabled || !v.active;
      box.toggle.textContent = collapsed ? v.chipText : "–";
      box.toggle.setAttribute("aria-expanded", String(!collapsed));
      // WCAG 2.5.3: the collapsed toggle shows the chip text, so its name must contain it
      box.toggle.setAttribute("aria-label", `${box.axis.toUpperCase()} ${box.side} filter box${collapsed ? `: ${v.chipText}` : ""}`);
      const endOn = Math.abs(look[AXIS_I[box.axis]]) > END_ON_DOT;
      box.grip.setAttribute("aria-valuemin", String(v.min));
      box.grip.setAttribute("aria-valuemax", String(v.max));
      box.grip.setAttribute("aria-valuenow", String(v.now));
      box.grip.setAttribute("aria-valuetext", v.ariaValueText);
      box.grip.setAttribute("aria-disabled", String(endOn || v.disabled));
      const p = placed.boxes.find((x) => x.id === box.key);
      if (p) {
        box.el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
        box.el.dataset.edge = p.edge;
      }
    }
  };
  store.subscribe(sync);
  new ResizeObserver(() => sync(store.get())).observe(layer);
  sync(store.get());
  // `filterUi.interacting` also marks keyboard focus, so Esc asks the grip drag itself
  return { dragging: () => drag !== null };
}


/**
 * The Reset filters icon on the canvas (22-8, replaces the Display filter section): a glass button at the stage's bottom right.
 * Its tooltip carries the filter copy; the live summary ("2 filters active, 0.2% hidden") is its accessible description, and it
 * takes the accent while any side is active. Hidden without a session.
 */
export function buildFilterReset(root: HTMLElement, store: Store<AppState>, onReset: () => void): void {
  const b = iconControl("filter-reset-all", "filterx", { onclick: onReset });
  root.style.right = `${RESET_HUD.right}px`;
  root.style.bottom = `${RESET_HUD.bottom}px`;
  root.style.width = `${RESET_HUD.size}px`;
  root.style.height = `${RESET_HUD.size}px`;
  root.append(b);
  const sync = (s: AppState) => {
    root.hidden = s.session === null;
    if (!s.session) return;
    const text = filterSummary(s.tools.filters, s.session.bounds, s.session.counts);
    b.setAttribute("aria-description", text);
    b.classList.toggle("active", !text.startsWith("0 "));
  };
  store.subscribe(sync);
  sync(store.get());
}
