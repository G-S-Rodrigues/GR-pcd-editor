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
  max_points: number;
}
export type ToolBody = BoxTool | PrismTool | FilterTool | ClusterTool;
