export type Vec3 = [number, number, number];
export interface Bounds {
  min: Vec3;
  max: Vec3;
}
export interface FieldInfo {
  name: string;
  type: string;
  size: number;
  count: number;
}
export interface Counts {
  original: number;
  active: number;
  deleted: number;
  invalid_total: number;
  invalid_active: number;
  displayed: number;
  selected: number;
  protected: number;
  /** Active points in no sub layer; 0 until a layer exists. */
  main: number;
  /** Active points in hidden layers; 0 until a layer exists. */
  hidden: number;
}
/** A named sub layer as the server reports it (counts are active valid members). */
export interface Layer {
  id: number;
  name: string;
  /** Index 0..15 into LAYER_COLOURS. */
  colour: number;
  visible: boolean;
  count: number;
  bounds: Bounds | null;
}
/** What a layer call reports besides the state (the dry run and the real run). */
export interface LayerOp {
  moved: number;
  from_other_layers: number;
  released: number;
}
export interface AxisFilter {
  enabled: boolean;
  min: number | null;
  max: number | null;
}
export interface DisplayFilter {
  x: AxisFilter;
  y: AxisFilter;
  z: AxisFilter;
}
export interface Protection {
  global: AxisFilter;
  operation: {
    mode: "inherit" | "add_local" | "override";
    local: { min: number; max: number } | null;
    acknowledge_override: boolean;
  };
  /** Absent when the slab is level. */
  tilt?: { rx_deg: number; ry_deg: number; pivot: [number, number] };
}
export interface HistoryEntry {
  index: number;
  kind: string;
  description: string;
  count: number;
  /** Stable step id (survives delete and reorder); absent only in old fixtures. */
  sid?: number;
  /** box | polygon | cluster | filter | selection | invalid. */
  tool?: string;
  /** The user's name for the step, null when unnamed. */
  name?: string | null;
  /** The editable shape the step was made with; null for sessions saved before shapes were stored. */
  shape?: StepShape | null;
  /** Exact min/max of the step's points; null when it has no finite point. */
  bounds?: Bounds | null;
}

/** A step's shape as the server stores it (the file frame, the same numbers the tool request carried). */
export interface StepBox {
  type: "box";
  center: Vec3;
  dimensions: Vec3;
  rpy_deg: Vec3;
  mode: "inside" | "outside";
}
export interface StepPrism {
  type: "prism";
  polygon: [number, number][];
  z_min: number;
  z_max: number;
  mode: "inside" | "outside";
}
export interface StepCluster {
  type: "cluster";
  seed_id: number;
  radius: number;
  max_points: number | null;
  exclude_protected: boolean;
  region: StepBox | StepPrism | null;
}
export interface StepSparse {
  type: "sparse";
  radius: number | null;
  min_neighbours: number;
  exclude_protected: boolean;
  region: StepBox | StepPrism | null;
}
export type StepShape = StepBox | StepPrism | StepCluster | StepSparse;
export interface SessionState {
  session_id: string;
  filename: string;
  encoding: string;
  schema: FieldInfo[];
  width: number;
  height: number;
  viewpoint: number[];
  counts: Counts;
  /** Sub layers in creation order; [] when the session has none. */
  layers: Layer[];
  bounds: Bounds | null;
  active_bounds: Bounds | null;
  revision: { cloud: number; params: number };
  display_filter: DisplayFilter;
  protection: Protection;
  selection: { id?: number; count: number; ops: unknown[] };
  history: { entries: HistoryEntry[]; cursor: number; can_undo: boolean; can_redo: boolean };
  unit: string;
  unsaved: boolean;
  client_state: Record<string, unknown>;
}

/** The operations the UI offers; Replace is gone from the UI (the first selection is live, see AppState.liveFirst). */
export type UiOp = "add" | "subtract" | "intersect";
/** The wire literal set (the server still accepts replace and invert). */
export type SelectionOp = "replace" | "add" | "subtract" | "intersect" | "invert";
export type Scope = "displayed" | "active";
export type RenderMode = "edited" | "original" | "deleted";
export type ToolKind = "none" | "box" | "polygon" | "cluster" | "sparse";

export interface Candidate {
  candidate_id: string;
  cloud_revision: number;
  params_revision: number;
  selected_active: number;
  protected_retained: number;
  candidates: number;
  selected_outside_display_filter: number;
  bounds: Bounds | null;
  effective_protection: unknown;
  cluster: unknown;
}

/** Result of a pending Add/Subtract/Intersect preview (view state, never saved). */
export interface PreviewState {
  id: string;
  op: "add" | "subtract" | "intersect";
  selected_after: number;
  base_selected: number;
  added: number;
  removed: number;
  /** Cluster summary of the previewed shape (same shape as `Candidate.cluster`). */
  cluster?: unknown;
}

export interface Notice {
  id: number;
  level: "info" | "warn" | "error";
  code: string;
  text: string;
}
