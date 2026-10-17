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
}
export interface SessionState {
  session_id: string;
  filename: string;
  encoding: string;
  schema: FieldInfo[];
  width: number;
  height: number;
  viewpoint: number[];
  counts: Counts;
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

export type SelectionOp = "replace" | "add" | "subtract" | "intersect" | "invert";
export type Scope = "displayed" | "active";
export type RenderMode = "edited" | "original" | "deleted";
export type ToolKind = "none" | "box" | "polygon" | "cluster";

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

export interface Notice {
  id: number;
  level: "info" | "warn" | "error";
  code: string;
  text: string;
}
