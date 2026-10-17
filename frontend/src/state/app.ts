import type { ColourMode } from "../colour/modes";
import { type FilterModel, emptyFilter } from "../inspector/filters";
import { DEFAULT_FLOOR_T, type ProtectionModel, emptyProtection } from "../inspector/protection";
import type { CompareMode } from "../compare/model";
import { type BoxModel, defaultBox } from "../tools/box/model";
import { type ClusterModel, defaultCluster } from "../tools/cluster/model";
import { type PolygonState, emptyPolygon } from "../tools/polygon/model";
import type { RenderData } from "../render/parse";
import { type Camera, defaultCamera } from "../view/camera";
import { type Slice, defaultSlice } from "../view/slice";
import { type Store, createStore } from "./store";
import type {
  Candidate,
  Notice,
  RenderMode,
  Scope,
  SelectionOp,
  SessionState,
  ToolKind,
} from "./types";

export interface ToolsState {
  box: BoxModel;
  polygon: PolygonState;
  cluster: ClusterModel;
  filters: FilterModel;
  protection: ProtectionModel;
}

export interface AppState {
  session: SessionState | null;
  tool: ToolKind;
  interaction: "orbit" | "pick-pivot" | "pick-seed" | "pick-floor" | "pick-slice";
  /** Half thickness of the floor slab made by "Pick floor point" (unit label only). */
  floorT: number;
  /** Rectangle select: dragging in an aligned ortho view makes the Box tool's box. */
  rect: boolean;
  /** Render-only slab (clipping); never changes selection, filters or counts. */
  slice: Slice;
  /** Render-only emphasis of protected-selected (kept) points. */
  showKept: boolean;
  op: SelectionOp;
  scope: Scope;
  camera: Camera;
  colour: { mode: ColourMode; pointSize: number };
  renderMode: RenderMode;
  compare: CompareMode;
  /** Opacity of the deleted overlay (0.05..1). */
  overlayOpacity: number;
  budget: number;
  render: RenderData | null;
  /** Second render for overlay (deleted) and split (edited). */
  render2: RenderData | null;
  rendering: boolean;
  candidate: Candidate | null;
  tools: ToolsState;
  gizmo: { snap: boolean; step: number; angleStep: number; local: boolean };
  /** A tool edit exists that has not been committed (Add/Subtract/Intersect drafts). */
  draft: boolean;
  job: { busy: boolean; progress: number | null; message: string | null };
  upload: { phase: "sending" | "importing"; loaded: number; total: number | null } | null;
  notices: Notice[];
}

export function initialState(): AppState {
  return {
    session: null,
    tool: "none",
    interaction: "orbit",
    floorT: DEFAULT_FLOOR_T,
    rect: false,
    slice: defaultSlice(),
    showKept: false,
    op: "replace",
    scope: "displayed",
    camera: defaultCamera(),
    colour: { mode: "height", pointSize: 3 },
    renderMode: "edited",
    compare: "edited",
    overlayOpacity: 0.35,
    budget: 1_000_000,
    render: null,
    render2: null,
    rendering: false,
    candidate: null,
    tools: {
      box: defaultBox([0, 0, 0]),
      polygon: emptyPolygon(),
      cluster: defaultCluster(),
      filters: emptyFilter(),
      protection: emptyProtection(),
    },
    gizmo: { snap: false, step: 0.1, angleStep: 5, local: true },
    draft: false,
    job: { busy: false, progress: null, message: null },
    upload: null,
    notices: [],
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
