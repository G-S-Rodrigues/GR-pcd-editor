import type { Axis, Side } from "../inspector/filters";
import { type Quat, rotate } from "../math/quat";
import { BAND, CUBE, LEGEND_BOX, PILL, TRIAD } from "../view/layout";
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
const MAX_BLOCKED_ROWS = 6;
export const END_ON_ENTER = 0.2;
export const END_ON_LEAVE = 0.3;
/** The legend menu, expanded (folding it never moves a box). */
export const LEGEND = { w: LEGEND_BOX.left + LEGEND_BOX.w + LEGEND_BOX.pad, h: LEGEND_BOX.top + LEGEND_BOX.maxH + LEGEND_BOX.pad };
const LANE = 156 + 2 * MARGIN; // a vertical lane of boxes at either side
const AXIS_I: Record<Axis, number> = { x: 0, y: 1, z: 2 };

/** The XYZ triad at the bottom-left, just above the timeline band. */
export const triadRect = (stage: { w: number; h: number }): Rect => ({
  l: TRIAD.left,
  t: stage.h - BAND - TRIAD.above - TRIAD.size,
  r: TRIAD.left + TRIAD.size,
  b: stage.h - BAND - TRIAD.above,
});

/** Stage rectangles the boxes never enter: legend, ViewCube with its arrows and the camera cluster, the triad and the timeline band. */
export const RESERVED = (stage: { w: number; h: number }): Rect[] => [
  { l: 0, t: 0, r: LEGEND.w, b: LEGEND.h },
  { l: stage.w - CUBE.w, t: 0, r: stage.w, b: CUBE.h },
  triadRect(stage),
  { l: 0, t: stage.h - BAND, r: stage.w, b: stage.h },
];

/** The band-hidden pill at the bottom centre of the stage; reserved only while it shows (a box would sit behind it and could not be clicked). */
export const pillRect = (stage: { w: number; h: number }): Rect => ({
  l: (stage.w - PILL.w) / 2,
  t: stage.h - PILL.bottom - PILL.h,
  r: (stage.w + PILL.w) / 2,
  b: stage.h - BAND,
});

export interface Item {
  desired: number;
  size: number;
}

/**
 * `spread1d` over [start, end] minus the `blocked` intervals (each widened by `gap`). Items keep their order; each goes to the
 * first free segment from its desired position's segment on that still has room, else it overflows. One segment is `spread1d`.
 */
export function spreadAround(items: Item[], start: number, end: number, gap: number, blocked: [number, number][]): { pos: number[]; overflow: number[] } {
  const segs: [number, number][] = [];
  let from = start;
  for (const [a, b] of [...blocked].sort((p, q) => p[0] - q[0])) {
    if (a - gap > from) segs.push([from, a - gap]);
    from = Math.max(from, b + gap);
  }
  if (end > from) segs.push([from, end]);
  if (segs.length === 1 && segs[0][0] === start && segs[0][1] === end) return spread1d(items, start, end, gap);
  const need = segs.map(() => 0);
  const count = segs.map(() => 0);
  const owner: number[] = [];
  const overflow: number[] = [];
  let s = 0;
  items.forEach((it, i) => {
    const centre = it.desired + it.size / 2;
    let first = segs.findIndex(([, hi]) => centre <= hi);
    if (first < 0) first = segs.length - 1;
    for (let k = Math.max(s, first); k < segs.length; k++) {
      const add = it.size + (count[k] ? gap : 0);
      if (need[k] + add <= segs[k][1] - segs[k][0]) {
        need[k] += add;
        count[k]++;
        owner[i] = k;
        s = k;
        return;
      }
    }
    overflow.push(i);
  });
  const pos: number[] = new Array(items.length);
  segs.forEach(([lo, hi], k) => {
    const idx = items.map((_, i) => i).filter((i) => owner[i] === k);
    const r = spread1d(idx.map((i) => items[i]), lo, hi, gap);
    idx.forEach((i, j) => (pos[i] = r.pos[j]));
  });
  return { pos: items.map((_, i) => i).filter((i) => !overflow.includes(i)).map((i) => pos[i]), overflow };
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
 * while its axis points at the viewer. Edges and docking use hysteresis; `lock` pins boxes being dragged or focused. `reserved`
 * are extra stage rectangles (the band-hidden pill) that no box may cover: a row slides around them or moves on to the next row.
 */
export function placeBoxes(
  orientation: Quat,
  stage: { w: number; h: number },
  prev: PlaceState | null,
  sizes: (id: string) => { w: number; h: number },
  lock: Set<string>,
  reserved: Rect[] = [],
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
    const hi = vertical ? (lane === "left" ? triadRect(stage).t - MARGIN : stage.h - BAND - MARGIN) : stage.w - (lane === "top" ? Math.max(LANE, CUBE.w + MARGIN) : LANE);
    for (let row = 0; list.length; row++) {
      list = [...list].sort((a, b) => a.t - b.t || BOX_IDS.findIndex((x) => boxKey(x) === a.id) - BOX_IDS.findIndex((x) => boxKey(x) === b.id));
      const inset = row * ((vertical ? maxW : maxH) + GAP);
      const cross = vertical ? maxW : maxH; // the row's strip across the lane
      const near = vertical ? (lane === "left" ? MARGIN + inset : stage.w - MARGIN - cross - inset) : lane === "top" ? MARGIN + inset : stage.h - BAND - MARGIN - cross - inset;
      const blocked = reserved
        .filter((c) => (vertical ? c.l < near + cross && near < c.r : c.t < near + cross && near < c.b))
        .map((c): [number, number] => (vertical ? [c.t, c.b] : [c.l, c.r]));
      const items = list.map((w) => {
        const size = vertical ? w.h : w.w;
        return { desired: lo + w.t * Math.max(0, hi - lo - size), size };
      });
      const { pos, overflow } = spreadAround(items, lo, hi, GAP, blocked);
      const kept = list.filter((_, i) => !overflow.includes(i));
      kept.forEach((w, k) => {
        const x = vertical ? (lane === "left" ? MARGIN + inset : stage.w - MARGIN - w.w - inset) : pos[k];
        const y = vertical ? pos[k] : lane === "top" ? MARGIN + inset : stage.h - BAND - MARGIN - w.h - inset;
        boxes.push({ id: w.id, axis: w.axis, side: w.side, edge: w.edge, row, x, y, w: w.w, h: w.h });
      });
      const next = list.filter((_, i) => overflow.includes(i));
      if (next.length === list.length && blocked.length && row < MAX_BLOCKED_ROWS) {
        list = next; // the reserved rectangle leaves no room in this row: try the row further in
        continue;
      }
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
