import { FILTER_COPY } from "../inspector/filters";
import { PROTECTION_COPY } from "../inspector/protection";
import { POLYGON_DEPTH_NOTE } from "../tools/polygon/model";

/** The Box tool hint (behind the ? in the Box header). */
export const BOX_NOTE =
  "Drag an arrow to resize that face (Alt: both sides), drag the box to move it, drag the small ring on an arrow to rotate about that axis. Shift is fine, Ctrl+drag orbits. Arrow keys nudge.";
/** The ? help texts of the other tool headers (worded from the approved 22 mockup). */
export const CLUSTER_HELP = "Pick a point: every point linked to it within the link distance is selected. Max points stops a runaway cluster.";
export const SPARSE_HELP = "Selects points with fewer than Min neighbours inside Radius. An empty radius uses one derived from the point spacing.";
export const PLANE_HELP = "Detect planes, then Select the points within Distance of one, or use it as the height protection band (a tilted band when the plane is tilted).";
export const THIN_HELP = "Duplicates selects all but one point closer than Distance; Voxel grid keeps one point per voxel of the given edge. The result is a selection that Delete removes.";

/** Explanatory inspector text blocks (README repeats them). */
export const COPY = {
  scope:
    "Scope decides which points a selection can reach: Displayed means only points that pass the display filter; Active means every point still in the cloud, including hidden ones.",
  protectionSlab: PROTECTION_COPY,
  polygonDepth: POLYGON_DEPTH_NOTE,
  filterVsDelete: FILTER_COPY,
} as const;
