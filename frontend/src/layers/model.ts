import type { AppState } from "../state/app";
import { MIN_EXTENT } from "../tools/box/model";
import type { Bounds, Layer, LayerOp, SessionState, StepBox } from "../state/types";

/** Sixteen layer colours, indexed by `Layer.colour`. None is the neutral grey of the main cloud. */
export const LAYER_COLOURS: readonly string[] = [
  "#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#42d4f4", "#f032e6", "#bfef45",
  "#fabed4", "#469990", "#dcbeff", "#9a6324", "#fffac8", "#800000", "#aaffc3", "#808000",
];
export const MAIN_COLOUR = "#9aa0a6";
/** The Main layer's chip on the light stage (3:1 on #e9ebef). */
export const LIGHT_MAIN_COLOUR = "#82888d";
export const mainColour = (theme: "dark" | "light"): string => (theme === "light" ? LIGHT_MAIN_COLOUR : MAIN_COLOUR);
export const MAX_LAYERS = 32;
export const HIDDEN_LAYER_NAME = "Hidden";

const fmt = (n: number) => n.toLocaleString("en-US");

export const layerColour = (colour: number): string => LAYER_COLOURS[((colour % 16) + 16) % 16];

/** Points in hidden layers (0 for a layer-less or absent session). */
export const hiddenPointCount = (s: SessionState | null): number => s?.counts.hidden ?? 0;

export const layersOf = (s: SessionState | null): readonly Layer[] => s?.layers ?? [];
export const findLayer = (s: SessionState | null, id: number): Layer | null => layersOf(s).find((l) => l.id === id) ?? null;
/** The layer Hide selected fills: the one named exactly "Hidden", if it exists. */
export const hiddenLayer = (s: SessionState | null): Layer | null => layersOf(s).find((l) => l.name === HIDDEN_LAYER_NAME) ?? null;

export const countText = (n: number): string => `${fmt(n)} ${n === 1 ? "point" : "points"}`;
export const MAIN_LABEL = (n: number): string => `Main (${fmt(n)})`;

export interface LayerRow {
  id: number;
  name: string;
  colour: string;
  /** The palette index 0..15 (the swatch that is pressed). */
  colourIndex: number;
  count: number;
  visible: boolean;
  label: string;
  eyeLabel: string;
  /** Null when Select works; else the reason, shown as the tooltip. */
  selectDisabled: string | null;
  /** Null when Edit works (a shown layer with points); else the reason. */
  editDisabled: string | null;
  protected: boolean;
  locked: boolean;
  /** The row tooltip: the label plus Protected / Locked. */
  title: string;
  toMainDisabled: string | null;
  mergeDisabled: string | null;
  deletePointsDisabled: string | null;
}

export const HIDE_LABEL = "Hide selected";
export const SHOW_LABEL = (n: number): string => `Show hidden (${fmt(n)})`;
export const HIDDEN_CHIP_TEXT = (n: number): string => `${fmt(n)} hidden - Show`;
export const SHOW_FIRST = "Show the layer first";
export const NO_POINTS = "The layer has no points";

export const LOCKED_REASON = "The layer is locked";
export const PROTECTED_REASON = "The layer is protected";
/** The tooltip of the shield and of the menu's Protected flag. */
export const protectedTip = (name: string): string => `Protected: the points of ${name} are never deleted by any Delete`;
export const NO_BAND = "Turn on height protection first";
export const NO_MERGE_TARGET = "No other layer to merge into";

/** The confirm before Merge; the second sentence only when the source loses its protection. */
export const mergeConfirmText = (from: Layer, into: Layer): string =>
  `Merge ${from.name} (${countText(from.count)}) into ${into.name}?${from.protected && !into.protected ? ` ${from.name}'s points lose protection.` : ""}`;
export const toMainProtectedText = (l: Layer): string =>
  `${l.name} is protected: its ${countText(l.count)} go back to main and lose protection. Continue?`;
export const deletePointsText = (l: Layer): string =>
  `Delete the ${countText(l.count)} of ${l.name}? It is a timeline step; Undo brings them back.`;

export function layerRows(s: SessionState | null): LayerRow[] {
  const all = layersOf(s);
  return all.map((l) => ({
    id: l.id,
    name: l.name,
    colour: layerColour(l.colour),
    colourIndex: ((l.colour % 16) + 16) % 16,
    count: l.count,
    visible: l.visible,
    label: `${l.name} (${fmt(l.count)})`,
    eyeLabel: `${l.visible ? "Hide" : "Show"} layer ${l.name}`,
    selectDisabled: !l.visible ? SHOW_FIRST : l.count === 0 ? "The layer has no points" : null,
    editDisabled: l.locked ? LOCKED_REASON : !l.visible ? SHOW_FIRST : l.count === 0 || !l.bounds ? NO_POINTS : null,
    protected: l.protected === true,
    locked: l.locked === true,
    title: `${l.name} (${fmt(l.count)})${l.protected ? ", Protected" : ""}${l.locked ? ", Locked" : ""}`,
    toMainDisabled: l.locked ? LOCKED_REASON : null,
    mergeDisabled: l.locked ? LOCKED_REASON : all.length < 2 ? NO_MERGE_TARGET : null,
    deletePointsDisabled: l.protected ? PROTECTED_REASON : !l.visible ? SHOW_FIRST : l.count === 0 ? NO_POINTS : null,
  }));
}

/** The confirm shown when an assignment would take points out of other layers; null when it takes none. */
export function stealConfirmText(op: LayerOp | null, name: string): string | null {
  if (!op || op.from_other_layers <= 0) return null;
  return `Move ${fmt(op.from_other_layers)} points out of other layers into ${name}?`;
}

/** The export dialog line for points in hidden layers; empty when none are hidden. */
export const hiddenExportNote = (n: number): string =>
  n > 0 ? `${fmt(n)} hidden points are exported too (hidden layers are exported unless unticked)` : "";

/** A box around a layer's members for Edit layer; every side keeps at least MIN_EXTENT. */
export function layerBoxShape(b: Bounds): StepBox {
  const center = [0, 1, 2].map((i) => (b.min[i] + b.max[i]) / 2) as StepBox["center"];
  const dimensions = [0, 1, 2].map((i) => Math.max(b.max[i] - b.min[i], MIN_EXTENT)) as StepBox["dimensions"];
  return { type: "box", center, dimensions, rpy_deg: [0, 0, 0], mode: "inside" };
}

/** The panel line while a layer is being edited. */
export const editingText = (name: string, members: number, selected: number): string =>
  `Editing layer ${name}: ${fmt(members)} members, the box selects ${fmt(selected)}`;

export const NO_SELECTION = "Select some points first";
export const AT_LIMIT = `At most ${MAX_LAYERS} layers`;
export const PICK_LAYER = "Click a layer row to choose it first";

type PanelState = Pick<AppState, "session" | "compare" | "draft" | "preview" | "layerUi">;

export interface LayerButtons {
  /** Null when the button works; else the reason (also its tooltip suffix). */
  create: string | null;
  assign: string | null;
  release: string | null;
  /** Set layer to selection (edit mode). */
  set: string | null;
  /** New layer from protected points. */
  fromBand: string | null;
  /** The layer the Assign button targets, if it still exists. */
  active: Layer | null;
}

/** Why the layer buttons are inactive now. One place; the panel and its tests read it. */
export function layerButtons(s: PanelState): LayerButtons {
  const active = findLayer(s.session, s.layerUi.active ?? -1);
  const base = !s.session
    ? "No file is open"
    : s.compare !== "edited"
      ? "Return to the edited view first"
      : s.draft || s.preview
        ? "Commit or discard the draft first"
        : s.session.selection.count === 0
          ? NO_SELECTION
          : null;
  const bandBase = !s.session ? "No file is open" : s.compare !== "edited" ? "Return to the edited view first" : s.draft || s.preview ? "Commit or discard the draft first" : null;
  return {
    create: base ?? (layersOf(s.session).length >= MAX_LAYERS ? AT_LIMIT : null),
    assign: base ?? (active ? (active.locked ? `${active.name} is locked` : null) : PICK_LAYER),
    release: base ?? (layersOf(s.session).length === 0 ? "There are no layers yet" : null),
    set: base,
    fromBand: bandBase ?? (!s.session?.protection.global.enabled ? NO_BAND : layersOf(s.session).length >= MAX_LAYERS ? AT_LIMIT : null),
    active,
  };
}

export interface ExportItem {
  /** 0 is Main. */
  id: number;
  label: string;
  count: number;
}

/** Main first, then every layer; hidden ones are marked because they are exported anyway. */
export function exportItems(s: SessionState | null): ExportItem[] {
  if (!s || s.layers.length === 0) return [];
  return [
    { id: 0, label: MAIN_LABEL(s.counts.main), count: s.counts.main },
    ...s.layers.map((l) => ({ id: l.id, label: `${l.name} (${fmt(l.count)})${l.visible ? "" : " (hidden, still exported)"}`, count: l.count })),
  ];
}

/** The `layers` field of an export request: null unless a strict subset is ticked, so the default request is unchanged. */
export function layersForRequest(s: SessionState | null, ticked: ReadonlySet<number>): number[] | null {
  const items = exportItems(s);
  if (items.length === 0 || items.every((i) => ticked.has(i.id))) return null;
  return items.filter((i) => ticked.has(i.id)).map((i) => i.id);
}

/** The exact number of points scope "active" exports for the ticked layers (invalid points travel with Main). */
export function exportedCount(s: SessionState, ticked: ReadonlySet<number>): number {
  const items = exportItems(s);
  if (items.length === 0) return s.counts.active;
  const sum = items.filter((i) => ticked.has(i.id)).reduce((n, i) => n + i.count, 0);
  return sum + (ticked.has(0) ? s.counts.invalid_active : 0);
}

export const NONE_TICKED = "Tick at least one layer to export";
export const EXPORT_WITHIN_LAYERS = "within the chosen layers; the exact count is reported after the export";

/** Layers colouring needs layers: with none left the mode is Turbo again. Returns the fixed colour, or null when fine. */
export function layerModeFix(s: Pick<AppState, "colour" | "session">): AppState["colour"] | null {
  return s.colour.mode === "layers" && layersOf(s.session).length === 0 ? { ...s.colour, mode: "turbo" } : null;
}

/** Whether edit mode has lost its footing: the file closed, the layer is gone or hidden, or the tool was disarmed (Clear selection). */
export function editEnded(s: Pick<AppState, "layerUi" | "session" | "tool">): boolean {
  const id = s.layerUi.editing;
  if (id === null) return false;
  const l = findLayer(s.session, id);
  return !l || !l.visible || s.tool === "none";
}
