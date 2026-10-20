import type { AttrArray, RenderData } from "../render/parse";

/**
 * "Hide selected": a client-side, view-only set of point ids that are not drawn and not pickable. It is never saved
 * and never changes the cloud or the export; part 15b replaces it with server-side layer visibility.
 */
export interface HiddenSet {
  /** Session the ids belong to (a different session discards the set). */
  sessionId: string | null;
  /** One byte per source id (`counts.original`), 1 = hidden. */
  bits: Uint8Array;
  size: number;
}

export const emptyHidden = (): HiddenSet => ({ sessionId: null, bits: new Uint8Array(0), size: 0 });
export const hiddenCount = (h: HiddenSet): number => h.size;
export const isHidden = (h: HiddenSet, id: number): boolean => id < h.bits.length && h.bits[id] === 1;

const FLAG_SELECTED_OR_PROTECTED = 3;

export interface StashResult {
  hidden: HiddenSet;
  /** Selected points found in the held render (the ones that were stashed). */
  flagged: number;
  /** Every selected point was in the render, so the hidden set equals the selection. */
  exact: boolean;
}

/** Adds the ids that carry the selected or protected flag in `render` to the set. */
export function stashSelected(prev: HiddenSet, render: RenderData, sessionId: string, original: number, selectedCount: number): StashResult {
  const keep = prev.sessionId === sessionId && prev.bits.length === original;
  const bits = keep ? prev.bits.slice() : new Uint8Array(original);
  let size = keep ? prev.size : 0;
  let flagged = 0;
  for (let i = 0; i < render.count; i++) {
    if ((render.flags[i] & FLAG_SELECTED_OR_PROTECTED) === 0) continue;
    flagged++;
    const id = render.ids[i];
    if (id < bits.length && bits[id] === 0) {
      bits[id] = 1;
      size++;
    }
  }
  return { hidden: { sessionId, bits, size }, flagged, exact: flagged === selectedCount };
}

/** Drops the hidden points from a render; returns the same object when nothing is hidden in it. */
export function applyHidden(r: RenderData, h: HiddenSet): RenderData {
  if (h.size === 0) return r;
  let drop = 0;
  for (let i = 0; i < r.count; i++) if (isHidden(h, r.ids[i])) drop++;
  if (drop === 0) return r;
  const n = r.count - drop;
  const coords = new Float32Array(n * 3);
  const ids = new Uint32Array(n);
  const flags = new Uint8Array(n);
  const attr: AttrArray | undefined = r.attr ? (new (r.attr.constructor as new (n: number) => AttrArray)(n)) : undefined;
  let j = 0;
  for (let i = 0; i < r.count; i++) {
    if (isHidden(h, r.ids[i])) continue;
    coords[j * 3] = r.coords[i * 3];
    coords[j * 3 + 1] = r.coords[i * 3 + 1];
    coords[j * 3 + 2] = r.coords[i * 3 + 2];
    ids[j] = r.ids[i];
    flags[j] = r.flags[i];
    if (attr && r.attr) attr[j] = r.attr[i];
    j++;
  }
  return { ...r, coords, ids, flags, attr, count: n, eligible: Math.max(0, r.eligible - drop) };
}

const fmt = (n: number) => n.toLocaleString("en-US");
export const hidePartialText = (flagged: number, selected: number): string =>
  `Hid ${fmt(flagged)} of ${fmt(selected)} selected points: the rest were not in the display budget sample and are still shown (raise the budget or select fewer points)`;
export const HIDDEN_CHIP_TEXT = (n: number): string => `${fmt(n)} hidden - Show`;
export const HIDE_LABEL = "Hide selected";
export const SHOW_LABEL = (n: number): string => `Show hidden (${fmt(n)})`;
export const HIDDEN_APPLY_TEXT = (n: number): string =>
  `${fmt(n)} points are hidden (view only); the selection may include hidden points inside the shape. Continue?`;
export const HIDDEN_SAVE_TEXT = (n: number): string => `${fmt(n)} hidden points are saved as visible`;
export const HIDDEN_SEED_TEXT = "That point is hidden";
export const HIDDEN_SELECT_REASON = "Show the hidden points first (this would include them)";
