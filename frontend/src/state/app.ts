import type { ColourMode } from "../colour/modes";
import { type FilterModel, emptyFilter } from "../inspector/filters";
import { type ProtectionModel, emptyProtection } from "../inspector/protection";
import type { CompareMode } from "../compare/model";
import { type BoxModel, defaultBox } from "../tools/box/model";
import { type ClusterModel, defaultCluster } from "../tools/cluster/model";
import { type PolygonState, emptyPolygon } from "../tools/polygon/model";
import type { RenderData } from "../render/parse";
import { type Camera, defaultCamera } from "../view/camera";
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
  interaction: "orbit" | "pick-pivot" | "pick-seed";
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
    op: "replace",
    scope: "displayed",
    camera: defaultCamera(),
    colour: { mode: "height", pointSize: 3 },
    renderMode: "edited",
    compare: "edited",
    overlayOpacity: 0.35,
    budget: 300_000,
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
export function addNotice(
  store: Store<AppState>,
  level: Notice["level"],
  code: string,
  text: string,
): void {
  store.update((s) => ({
    ...s,
    notices: [...s.notices.filter((n) => n.code !== code), { id: ++noticeId, level, code, text }].slice(-5),
  }));
}
export function dismissNotice(store: Store<AppState>, id: number): void {
  store.update((s) => ({ ...s, notices: s.notices.filter((n) => n.id !== id) }));
}
