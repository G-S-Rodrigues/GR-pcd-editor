import type { Axis, Side } from "../inspector/filters";
import { type Quat, rotate } from "../math/quat";
import { CUBE } from "../view/layout";
import { BOX_IDS, boxKey } from "./model";

export { CUBE };

export type Edge = "left" | "right" | "top" | "bottom" | "dock";

export interface PlacedBox {
  id: string;
  axis: Axis;
  side: Side;
  edge: Edge;
  /** 0 = against the edge; each further row sits one box further in. */
  row: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlaceState {
  edges: Record<string, Edge>;
  endOn: Record<Axis, boolean>;
}

export interface Rect {
  l: number;
  t: number;
  r: number;
  b: number;
}

export const MARGIN = 6;
const GAP = 6;
export const END_ON_ENTER = 0.2;
export const END_ON_LEAVE = 0.3;
const LEGEND = { w: 170, h: 130 }; // top-left
const LANE = 156 + 2 * MARGIN; // a vertical lane of boxes at either side
const AXIS_I: Record<Axis, number> = { x: 0, y: 1, z: 2 };

/** Stage rectangles the boxes never enter (legend, ViewCube with its triad and the camera cluster). */
export const RESERVED = (stage: { w: number; h: number }): Rect[] => [
  { l: 0, t: 0, r: LEGEND.w, b: LEGEND.h },
  { l: stage.w - CUBE.w, t: 0, r: stage.w, b: CUBE.h },
];

export interface Item {
  desired: number;
  size: number;
}

/**
 * Places items (already in order) along [start, end] with `gap` between them, each as close to its desired position as
 * order allows. Items that cannot fit are dropped from the end of the order and returned as `overflow` indices.
 */
export function spread1d(items: Item[], start: number, end: number, gap: number): { pos: number[]; overflow: number[] } {
  const kept: number[] = [];
  let need = 0;
  const overflow: number[] = [];
  items.forEach((it, i) => {
    const add = it.size + (kept.length ? gap : 0);
    if (need + add <= end - start) {
      kept.push(i);
      need += add;
    } else overflow.push(i);
  });
  const pos: number[] = [];
  let cursor = start;
  for (const i of kept) {
    const p = Math.max(items[i].desired, cursor);
    pos.push(p);
    cursor = p + items[i].size + gap;
  }
  for (let k = kept.length - 1; k >= 0; k--) {
    const limit = k === kept.length - 1 ? end : pos[k + 1] - gap;
    pos[k] = Math.min(pos[k], limit - items[kept[k]].size);
  }
  return { pos, overflow };
}

interface Want {
  id: string;
  axis: Axis;
  side: Side;
  edge: Edge;
  t: number;
  w: number;
  h: number;
}

/**
 * Axis-aware positions for the six filter boxes. A box sits on the screen edge its axis direction points to (Z top or
 * bottom in the presets), slides along it with the other screen component, and docks at the bottom of the left edge
 * while its axis points at the viewer. Edges and docking use hysteresis; `lock` pins boxes being dragged or focused.
 */
export function placeBoxes(
  orientation: Quat,
  stage: { w: number; h: number },
  prev: PlaceState | null,
  sizes: (id: string) => { w: number; h: number },
  lock: Set<string>,
): { boxes: PlacedBox[]; state: PlaceState } {
  const right = rotate(orientation, [1, 0, 0]);
  const up = rotate(orientation, [0, 1, 0]);
  const state: PlaceState = { edges: {}, endOn: { x: false, y: false, z: false } };
  const wants: Want[] = [];
  for (const axis of ["x", "y", "z"] as Axis[]) {
    const i = AXIS_I[axis];
    const len = Math.hypot(right[i], up[i]);
    const was = prev?.endOn[axis] ?? false;
    state.endOn[axis] = was ? len <= END_ON_LEAVE : len < END_ON_ENTER;
  }
  for (const b of BOX_IDS) {
    const id = boxKey(b);
    const i = AXIS_I[b.axis];
    const dir = b.side === "max" ? 1 : -1;
    const sx = dir * right[i];
    const sy = dir * up[i];
    const len = Math.hypot(sx, sy);
    const before = prev?.edges[id];
    let edge: Edge;
    if (lock.has(id) && before) edge = before;
    else if (state.endOn[b.axis]) edge = "dock";
    else {
      const score: Record<Exclude<Edge, "dock">, number> = { right: sx, left: -sx, top: sy, bottom: -sy };
      const order: Exclude<Edge, "dock">[] = ["right", "left", "top", "bottom"];
      let best = order[0];
      for (const e of order) if (score[e] > score[best]) best = e;
      edge = best;
      if (before && before !== "dock" && before !== best && score[best] <= 1.2 * score[before] + 0.05) edge = before;
    }
    state.edges[id] = edge;
    const along = edge === "left" || edge === "right" ? -sy : sx; // grows down / right
    const t = edge === "dock" ? 1 : Math.min(0.9, Math.max(0.1, 0.5 + (0.5 * along) / (len || 1)));
    wants.push({ id, axis: b.axis, side: b.side, edge, t, ...sizes(id) });
  }
  const maxW = Math.max(...wants.map((w) => w.w));
  const maxH = Math.max(...wants.map((w) => w.h));
  const boxes: PlacedBox[] = [];
  const lanes: Edge[] = ["left", "right", "top", "bottom"];
  for (const lane of lanes) {
    let list = wants.filter((w) => (lane === "left" ? w.edge === "left" || w.edge === "dock" : w.edge === lane));
    const vertical = lane === "left" || lane === "right";
    const lo = vertical ? Math.max(LEGEND.h, CUBE.h) + MARGIN : lane === "top" ? LEGEND.w + MARGIN : LANE;
    const hi = vertical ? stage.h - MARGIN : stage.w - LANE;
    for (let row = 0; list.length; row++) {
      list = [...list].sort((a, b) => a.t - b.t || BOX_IDS.findIndex((x) => boxKey(x) === a.id) - BOX_IDS.findIndex((x) => boxKey(x) === b.id));
      const items = list.map((w) => {
        const size = vertical ? w.h : w.w;
        return { desired: lo + w.t * Math.max(0, hi - lo - size), size };
      });
      const { pos, overflow } = spread1d(items, lo, hi, GAP);
      const kept = list.filter((_, i) => !overflow.includes(i));
      kept.forEach((w, k) => {
        const inset = row * ((vertical ? maxW : maxH) + GAP);
        const x = vertical ? (lane === "left" ? MARGIN + inset : stage.w - MARGIN - w.w - inset) : pos[k];
        const y = vertical ? pos[k] : lane === "top" ? MARGIN + inset : stage.h - MARGIN - w.h - inset;
        boxes.push({ id: w.id, axis: w.axis, side: w.side, edge: w.edge, row, x, y, w: w.w, h: w.h });
      });
      const next = list.filter((_, i) => overflow.includes(i));
      if (next.length === list.length) {
        // nothing fits even alone (stage far too small): stack the rest where they are rather than loop
        next.forEach((w) => boxes.push({ id: w.id, axis: w.axis, side: w.side, edge: w.edge, row, x: MARGIN, y: MARGIN, w: w.w, h: w.h }));
        break;
      }
      list = next;
    }
  }
  boxes.sort((a, b) => BOX_IDS.findIndex((x) => boxKey(x) === a.id) - BOX_IDS.findIndex((x) => boxKey(x) === b.id));
  return { boxes, state };
}
