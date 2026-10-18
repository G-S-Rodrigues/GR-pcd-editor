/** Pixel sizes of the top-right stage corner, shared by the builders and the filter-box placement (one place, no drift). */
export const CUBE_STAGE = 110; // the ViewCube's own square
export const CUBE_TOP = 14;
export const CUBE_RIGHT = 14;
/** The camera cluster: a row of four icon buttons under the ViewCube. */
export const CLUSTER = { btn: 32, between: 2, gap: 6, count: 4, w: 4 * 32 + 3 * 2, h: 32 } as const;
/** Reserved top-right rectangle: the cube and its XYZ triad (hangs 34 px left of the cube) plus the cluster below. */
export const CUBE = { w: 160, h: CUBE_TOP + CUBE_STAGE + CLUSTER.gap + CLUSTER.h + 8 } as const;
