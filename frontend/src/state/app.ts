import type { ColourMode } from "../colour/modes";
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

export interface AppState {
  session: SessionState | null;
  tool: ToolKind;
  interaction: "orbit" | "pick-pivot";
  op: SelectionOp;
  scope: Scope;
  camera: Camera;
  colour: { mode: ColourMode; pointSize: number };
  renderMode: RenderMode;
  budget: number;
  render: RenderData | null;
  rendering: boolean;
  candidate: Candidate | null;
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
    budget: 300_000,
    render: null,
    rendering: false,
    candidate: null,
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
