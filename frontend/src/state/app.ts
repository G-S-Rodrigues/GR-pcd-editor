import type { SectionsOpen } from "../ui/sections";
import type { ColourMode } from "../colour/modes";
import { DEFAULT_SELECTED, type SelectedColourId } from "../colour/selectcolour";
import { type FilterModel, emptyFilter } from "../inspector/filters";
import { DEFAULT_FLOOR_T, type ProtectionModel, emptyProtection } from "../inspector/protection";
import type { CompareMode } from "../compare/model";
import { type BoxModel, defaultBox } from "../tools/box/model";
import { type ClusterModel, defaultCluster } from "../tools/cluster/model";
import { type SparseModel, defaultSparse } from "../tools/sparse/model";
import { type PlaneModel, type PlanesState, defaultPlane, emptyPlanes } from "../tools/plane/model";
import { type ThinModel, defaultThin } from "../tools/thin/model";
import { type PolygonState, emptyPolygon } from "../tools/polygon/model";
import type { RenderData } from "../render/parse";
import { type TimelineState, emptyTimeline } from "../timeline/model";
import { type Camera, defaultCamera } from "../view/camera";
import { type Store, createStore } from "./store";
import type {
  Candidate,
  LayerUi,
  Notice,
  PreviewState,
  RenderMode,
  Scope,
  UiOp,
  SessionState,
  ToolKind,
} from "./types";

export interface ToolsState {
  box: BoxModel;
  polygon: PolygonState;
  cluster: ClusterModel;
  sparse: SparseModel;
  plane: PlaneModel;
  thin: ThinModel;
  filters: FilterModel;
  protection: ProtectionModel;
}

/** On-canvas filter boxes: which are collapsed (key `x-min`..`z-max`) and which one a pointer or the keyboard holds. */
export interface FilterUi {
  collapsed: Record<string, boolean>;
  interacting: string | null;
}

export interface AppState {
  session: SessionState | null;
  tool: ToolKind;
  interaction: "orbit" | "pick-pivot" | "pick-seed" | "pick-floor";
  /** Half thickness of the floor slab made by "Pick floor point" (unit label only). */
  floorT: number;
  /** Rectangle select: dragging in an aligned ortho view makes the Box tool's box. */
  rect: boolean;
  /** Render-only emphasis of protected-selected (kept) points. */
  showKept: boolean;
  op: UiOp;
  /** Shape edits preview the result at once (default); off: edits only move the outline and Commit computes it. Saved only when off. */
  previewLive: boolean;
  /**
   * The next tool edits are the first selection: they go live as a wire replace (no preview, no accumulation).
   * True while the committed selection is empty and the user has not pressed an operation; never saved.
   */
  liveFirst: boolean;
  scope: Scope;
  camera: Camera;
  colour: { mode: ColourMode; pointSize: number };
  /** Colour preset of selected (candidate) points; saved only when not the default. */
  selectedColour: SelectedColourId;
  renderMode: RenderMode;
  compare: CompareMode;
  /** Opacity of the deleted overlay (0.05..1). */
  overlayOpacity: number;
  budget: number;
  render: RenderData | null;
  /** Second render for overlay (deleted) and split (edited). */
  render2: RenderData | null;
  /** Render of the highlighted (or hovered) history step: only that step's deleted points; view-only. */
  stepRender: RenderData | null;
  rendering: boolean;
  candidate: Candidate | null;
  tools: ToolsState;
  gizmo: { snap: boolean; step: number; angleStep: number };
  /** Id of the box arrow or ring under the pointer (drawn heavier); view-only, never saved. */
  boxHover: string | null;
  /** A tool edit exists that has not been committed (Add/Subtract/Intersect drafts). */
  draft: boolean;
  /** The server-side pending result of the drafted shape, drawn but not committed; null when none. */
  preview: PreviewState | null;
  /** `preview`: the running job only computes the pending preview of a drafted shape (it never touches the committed selection, so Apply stays usable). */
  job: { busy: boolean; preview?: boolean; progress: number | null; message: string | null };
  upload: { phase: "sending" | "importing"; loaded: number; total: number | null } | null;
  notices: Notice[];
  filterUi: FilterUi;
  /** The "Height protection" panel section is expanded (protected points are drawn stronger while it is). */
  floorPanelOpen: boolean;
  /** Inspector sections the user folded (missing = open); see ui/sections.ts. */
  sectionsOpen: SectionsOpen;
  /** The legend and mode-line menu on the canvas is unfolded (only a folded menu is saved). */
  legendOpen: boolean;
  /** History strip view state (highlight, hover, rename, marker drag); never saved. */
  timeline: TimelineState;
  /** Layer panel view state: the layer being edited and the one a legend row last acted on. Never saved. */
  layerUi: LayerUi;
  /** Detected planes (client only, never saved) and the plane the Planes tool has chosen. */
  planes: PlanesState;
}

export function initialState(): AppState {
  return {
    session: null,
    tool: "none",
    interaction: "orbit",
    floorT: DEFAULT_FLOOR_T,
    rect: false,
    showKept: false,
    op: "add",
    previewLive: true,
    liveFirst: false,
    scope: "displayed",
    camera: defaultCamera(),
    colour: { mode: "turbo", pointSize: 3 },
    selectedColour: DEFAULT_SELECTED,
    renderMode: "edited",
    compare: "edited",
    overlayOpacity: 0.35,
    budget: 1_000_000,
    render: null,
    render2: null,
    stepRender: null,
    rendering: false,
    candidate: null,
    tools: {
      box: defaultBox([0, 0, 0]),
      polygon: emptyPolygon(),
      cluster: defaultCluster(),
      sparse: defaultSparse(),
      plane: defaultPlane(),
      thin: defaultThin(),
      filters: emptyFilter(),
      protection: emptyProtection(),
    },
    gizmo: { snap: false, step: 0.1, angleStep: 5 },
    boxHover: null,
    draft: false,
    preview: null,
    job: { busy: false, progress: null, message: null },
    upload: null,
    notices: [],
    filterUi: { collapsed: {}, interacting: null },
    floorPanelOpen: true,
    sectionsOpen: {},
    legendOpen: true,
    timeline: emptyTimeline(),
    layerUi: { editing: null, active: null },
    planes: emptyPlanes(),
  };
}

export const createAppStore = (): Store<AppState> => createStore(initialState());

let noticeId = 0;
/** How long a notice stays: errors need longer to be read than warnings and info. */
export const NOTICE_MS: Record<Notice["level"], number> = { info: 8000, warn: 8000, error: 15000 };
export function addNotice(
  store: Store<AppState>,
  level: Notice["level"],
  code: string,
  text: string,
): void {
  const id = ++noticeId;
  store.update((s) => ({
    ...s,
    notices: [...s.notices.filter((n) => n.code !== code), { id, level, code, text }].slice(-5),
  }));
  setTimeout(() => dismissNotice(store, id), NOTICE_MS[level]); // by id: a newer notice with the same code is not touched
}
/** Removes every notice with one of these codes (a later success makes them stale). */
export function clearNotices(store: Store<AppState>, codes: readonly string[]): void {
  if (store.get().notices.some((n) => codes.includes(n.code))) {
    store.update((s) => ({ ...s, notices: s.notices.filter((n) => !codes.includes(n.code)) }));
  }
}
export function dismissNotice(store: Store<AppState>, id: number): void {
  store.update((s) => ({ ...s, notices: s.notices.filter((n) => n.id !== id) }));
}
