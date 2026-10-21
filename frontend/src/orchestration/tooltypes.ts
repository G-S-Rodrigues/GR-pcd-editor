import type { Vec3 } from "../state/types";

export interface BoxTool {
  type: "box";
  center: Vec3;
  dimensions: Vec3;
  rpy_deg: Vec3;
  mode: "inside" | "outside";
}
export interface PrismTool {
  type: "prism";
  polygon: [number, number][];
  z_min: number;
  z_max: number;
  mode: "inside" | "outside";
}
export interface FilterTool {
  type: "filter";
}
export interface ClusterTool {
  type: "cluster";
  seed_id: number;
  radius: number;
  region: BoxTool | PrismTool | null;
  exclude_protected: boolean;
  max_points: number | null;
  on_limit?: "fail" | "partial";
}
export interface SparseTool {
  type: "sparse";
  radius: number | null;
  min_neighbours: number;
  region: BoxTool | PrismTool | null;
  exclude_protected: boolean;
}
export interface PlaneTool {
  type: "plane";
  normal: Vec3;
  d: number;
  thickness: number;
  region: BoxTool | PrismTool | null;
  exclude_protected: boolean;
}
export interface ThinTool {
  type: "thin";
  method: "duplicates" | "voxel";
  distance: number;
  edge: number;
  region: BoxTool | PrismTool | null;
  exclude_protected: boolean;
}
export interface LayerTool {
  type: "layer";
  layer_id: number;
}
export type ToolBody = BoxTool | PrismTool | FilterTool | ClusterTool | SparseTool | PlaneTool | ThinTool | LayerTool;
