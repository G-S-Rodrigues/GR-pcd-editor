import { PALETTE, type Rgb } from "../colour/palette";
import type { SessionState } from "../state/types";

/** Geometry of the strip (px): every step card is CARD_W wide, GAP apart; the track starts PAD in. */
export const CARD_W = 76;
export const GAP = 8;
export const PAD = 12;
export const MARKER_W = 14;

export type IconId = "box" | "polygon" | "cluster" | "filter" | "other" | "invalid" | "layer";

/** The glyph on a step card. */
export const STEP_GLYPH: Record<IconId, string> = { box: "▢", polygon: "⬠", cluster: "⁘", filter: "≡", invalid: "⊘", layer: "▤", other: "✂" };

const TITLES: Record<string, string> = {
  box: "Box",
  polygon: "Polygon",
  cluster: "Cluster",
  filter: "Filter",
  selection: "Selection",
  invalid: "Remove invalid",
  layer: "Layer edit",
};
export const toolTitle = (tool: string | undefined): string => (tool && TITLES[tool]) || "Selection";

export function iconFor(tool: string | undefined): IconId {
  switch (tool) {
    case "box":
    case "polygon":
    case "cluster":
    case "filter":
    case "invalid":
    case "layer":
      return tool;
    default:
      return "other";
  }
}

export interface StepView {
  sid: number;
  index: number;
  tool: string;
  name: string | null;
  label: string;
  count: number;
  greyed: boolean;
  icon: IconId;
  tooltip: string;
  /** False for a layer step a later layer step builds on (the server says so); deletion steps are always true. */
  deletable: boolean;
}

const fmt = (n: number) => n.toLocaleString("en-US");

export function stepTooltip(s: { tool: string; name: string | null; count: number; greyed: boolean; description?: string }): string {
  const pts = `${fmt(s.count)} point${s.count === 1 ? "" : "s"}`;
  if (s.tool === "layer") {
    // the server's description often carries the count already: do not say it twice
    const head = s.name ?? s.description ?? toolTitle(s.tool);
    return `${head.includes(pts) ? head : `${head}, ${pts}`}${s.greyed ? " - rolled back" : ""}. Click to highlight; double-click the name to rename`;
  }
  const head = s.name ?? toolTitle(s.tool);
  const verb = s.tool === "invalid" && !s.name ? head : `${head} delete`;
  return `${verb}, ${pts}${s.greyed ? " - rolled back" : ""}. Click to highlight; double-click the name to rename`;
}

export function stepsOf(session: SessionState | null): StepView[] {
  if (!session) return [];
  const { entries, cursor } = session.history;
  return entries.map((e, i) => {
    const tool = e.tool ?? "selection";
    const name = e.name ?? null;
    const greyed = i >= cursor;
    return {
      sid: e.sid ?? e.index,
      index: i,
      tool,
      name,
      label: name ?? `${toolTitle(tool)} ${i + 1}`,
      count: e.count,
      greyed,
      icon: iconFor(tool),
      tooltip: stepTooltip({ tool, name, count: e.count, greyed, description: e.description }),
      deletable: e.deletable !== false,
    };
  });
}

// ---- marker geometry

export const PITCH = CARD_W + GAP;
/** Centre x of marker slot k (0 = before the first step, n = after the last) in strip content pixels. */
export const slotX = (k: number): number => PAD + k * PITCH - GAP / 2;
export const markerSlots = (n: number): number[] => Array.from({ length: n + 1 }, (_, k) => slotX(k));
/** Nearest slot to a content x (client x - scroller left + scrollLeft), clamped to 0..n. */
export const slotFromX = (contentX: number, n: number): number => {
  const k = Math.round((contentX - PAD + GAP / 2) / PITCH);
  return Math.max(0, Math.min(n, k));
};

export function nextFocus(index: number, key: string, n: number): number {
  if (key === "ArrowRight") return Math.min(n - 1, index + 1);
  if (key === "ArrowLeft") return Math.max(0, index - 1);
  if (key === "Home") return 0;
  if (key === "End") return Math.max(0, n - 1);
  return index;
}

/** The cursor a slider key asks for, or null when the key is not one. */
export function sliderTarget(key: string, cursor: number, n: number): number | null {
  if (key === "ArrowLeft") return Math.max(0, cursor - 1);
  if (key === "ArrowRight") return Math.min(n, cursor + 1);
  if (key === "Home") return 0;
  if (key === "End") return n;
  return null;
}

// ---- view state (never persisted)

export interface TimelineState {
  /** The step whose deleted points are drawn in the highlight colour (sid). */
  highlight: number | null;
  /** The step under the pointer: a lighter preview. */
  hover: number | null;
  /** The step whose name is being edited. */
  renaming: number | null;
  /** The slot the marker is being dragged to; null when no drag. */
  dragging: number | null;
}
export const emptyTimeline = (): TimelineState => ({ highlight: null, hover: null, renaming: null, dragging: null });

export const clickStep = (t: TimelineState, sid: number): TimelineState => ({ ...t, highlight: t.highlight === sid ? null : sid });
export const clearHighlight = (t: TimelineState): TimelineState => (t.highlight === null ? t : { ...t, highlight: null });
export const setHover = (t: TimelineState, sid: number | null): TimelineState => (t.hover === sid ? t : { ...t, hover: sid });

export const startRename = (t: TimelineState, sid: number): TimelineState => ({ ...t, renaming: sid });
export const cancelRename = (t: TimelineState): TimelineState => ({ ...t, renaming: null });
/** `name` is the trimmed text ("" clears the name); null when no rename was in progress. */
export function commitRename(t: TimelineState, text: string): { timeline: TimelineState; name: string | null } {
  if (t.renaming === null) return { timeline: t, name: null };
  return { timeline: { ...t, renaming: null }, name: text.trim() };
}

/** Esc: ends a drag, then a rename, then clears the highlight; `used` tells whether anything was active. */
export function escapeKey(t: TimelineState): { timeline: TimelineState; used: boolean } {
  if (t.dragging !== null) return { timeline: { ...t, dragging: null }, used: true };
  if (t.renaming !== null) return { timeline: { ...t, renaming: null }, used: true };
  if (t.highlight !== null) return { timeline: { ...t, highlight: null }, used: true };
  return { timeline: t, used: false };
}

/** Drops every reference to a step that is no longer in the history. */
export function reconcile(t: TimelineState, session: SessionState | null): TimelineState {
  if (!session) {
    return t.highlight === null && t.hover === null && t.renaming === null && t.dragging === null ? t : emptyTimeline();
  }
  const live = new Set(session.history.entries.map((e) => e.sid ?? e.index));
  const keep = (v: number | null) => (v !== null && live.has(v) ? v : null);
  const next = { ...t, highlight: keep(t.highlight), hover: keep(t.hover), renaming: keep(t.renaming) };
  return next.highlight === t.highlight && next.hover === t.hover && next.renaming === t.renaming ? t : next;
}

export const dragStart = (t: TimelineState, slot: number): TimelineState => ({ ...t, dragging: slot });
export const dragMove = (t: TimelineState, slot: number): TimelineState => (t.dragging === null ? t : { ...t, dragging: slot });
export const dragCancel = (t: TimelineState): TimelineState => (t.dragging === null ? t : { ...t, dragging: null });
/** One rollback on release, and only when the marker really moved. */
export function dragEnd(t: TimelineState, cursor: number): { timeline: TimelineState; rollbackTo: number | null } {
  const to = t.dragging;
  return { timeline: dragCancel(t), rollbackTo: to !== null && to !== cursor ? to : null };
}

export type StripAction = { type: "delete" } | { type: "rename" } | { type: "highlight" } | { type: "focus" } | { type: "slider" };
/** What the strip does with a key; null = not its key (it falls through to the global handlers). */
export function stripKeyAction(key: string, where: "step" | "marker" | "input"): StripAction | null {
  if (where === "input") return null;
  if (where === "marker") return ["ArrowLeft", "ArrowRight", "Home", "End"].includes(key) ? { type: "slider" } : null;
  if (key === "Delete" || key === "Backspace") return { type: "delete" };
  if (key === "F2") return { type: "rename" };
  if (key === "Enter" || key === " ") return { type: "highlight" };
  if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(key)) return { type: "focus" };
  return null;
}

/**
 * The rename answer carries a whole session snapshot taken when the server handled it. Take only the step names from
 * it: the revision, cursor and counts of the current state may already be newer (a rollback or an apply that answered
 * first). A different session id, or a step the current state no longer has, changes nothing.
 */
export function mergeStepNames(current: SessionState, answer: SessionState): SessionState {
  if (answer.session_id !== current.session_id) return current;
  const names = new Map(answer.history.entries.map((e) => [e.sid ?? e.index, e.name ?? null]));
  let changed = false;
  const entries = current.history.entries.map((e) => {
    const key = e.sid ?? e.index;
    if (!names.has(key) || (names.get(key) ?? null) === (e.name ?? null)) return e;
    changed = true;
    return { ...e, name: names.get(key) ?? null };
  });
  return changed ? { ...current, history: { ...current.history, entries } } : current;
}

/**
 * Delete/Backspace on a control inside the strip other than a card or the rename input (a step's own buttons, the
 * marker): the strip must still consume the key, or it falls through to the global Delete = Apply. A step button removes
 * its step (same as the card), the marker ignores the key.
 */
export function stripControlKey(key: string, where: "button" | "marker"): "delete" | "swallow" | null {
  if (key !== "Delete" && key !== "Backspace") return null;
  return where === "button" ? "delete" : "swallow";
}

// ---- confirmations

/** The delete button of a step: layer steps that a later one builds on cannot be removed. */
export const DELETE_BLOCKED_TEXT = "A later layer edit builds on this one; remove that one first";
export const deleteState = (s: { deletable: boolean }): { enabled: boolean; title: string } =>
  s.deletable ? { enabled: true, title: "Delete this step" } : { enabled: false, title: DELETE_BLOCKED_TEXT };

export const discardCount = (session: SessionState | null): number =>
  session ? Math.max(0, session.history.entries.length - session.history.cursor) : 0;
export const discardText = (n: number): string =>
  `Applying a new deletion discards the ${n} rolled-back step(s) after the marker (they cannot be redone). Continue?`;
export const deleteStepText = (label: string, count: number): string =>
  `Remove step "${label}"? Its ${fmt(count)} points come back (or stay active if rolled back); later steps are kept. This cannot be undone. Continue?`;

export const deleteLayerStepText = (label: string, count: number): string =>
  `Remove step "${label}"? Its ${fmt(count)} points go back to their earlier layer; later steps are kept. This cannot be undone. Continue?`;

// ---- view model

export interface CardView extends StepView {
  highlighted: boolean;
  renaming: boolean;
}
export interface TimelineView {
  hidden: boolean;
  empty: boolean;
  emptyText: string;
  cards: CardView[];
  marker: { slot: number; max: number; now: number; valuetext: string; x: number };
  trackWidth: number;
}

export function timelineView(session: SessionState | null, t: TimelineState): TimelineView {
  const steps = stepsOf(session);
  const n = steps.length;
  const cursor = session ? Math.max(0, Math.min(n, session.history.cursor)) : 0;
  const valuetext =
    cursor === 0 && n > 0 ? `Before the first step (${n} step${n === 1 ? "" : "s"} rolled back)` : `After step ${cursor} of ${n}`;
  return {
    hidden: session === null,
    empty: n === 0,
    emptyText: "No steps yet",
    cards: steps.map((s) => ({ ...s, highlighted: t.highlight === s.sid, renaming: t.renaming === s.sid })),
    marker: { slot: cursor, max: n, now: cursor, valuetext, x: slotX(cursor) },
    trackWidth: PAD * 2 + n * PITCH - GAP,
  };
}

export interface StepLayerStyle {
  sid: number;
  colour: Rgb;
  opacity: number;
  /** Added to the point size so the highlight sits visibly on top of the main layer. */
  sizeDelta: number;
  hover: boolean;
}
/** How the highlight layer looks: null when no step is shown. Hovering another step previews it lighter. */
export function stepLayerStyle(t: TimelineState): StepLayerStyle | null {
  if (t.hover !== null && t.hover !== t.highlight) {
    return { sid: t.hover, colour: PALETTE.stepHover, opacity: 0.7, sizeDelta: 2, hover: true };
  }
  if (t.highlight !== null) return { sid: t.highlight, colour: PALETTE.step, opacity: 0.95, sizeDelta: 2, hover: false };
  return null;
}
