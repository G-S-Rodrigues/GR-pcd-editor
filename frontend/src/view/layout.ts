/** Pixel sizes of the corners of the stage, shared by the builders and the filter-box placement (one place, no drift). */
export const CUBE_STAGE = 110; // the ViewCube's own square (faces, ids cube-*)
export const CUBE_SIDE = 54; // px, the cube's edge length
/** The wrapper holds the cube in its middle and the six arrows and corner zones around it. */
export const CUBE_WRAP = 192;
export const CUBE_TOP = 8;
export const CUBE_RIGHT = 8;
/** The camera cluster: a row of four icon buttons under the ViewCube. */
export const CLUSTER = { btn: 32, between: 2, gap: 6, count: 4, w: 4 * 32 + 3 * 2, h: 32 } as const;
/** Reserved top-right rectangle: the cube with its arrows plus the cluster below. */
export const CUBE = { w: CUBE_WRAP + 2 * CUBE_RIGHT, h: CUBE_TOP + CUBE_WRAP + CLUSTER.gap + CLUSTER.h + 8 } as const;
/** Arrow ring and corner zones around the cube centre (px). Arrows sit on `ring`, corner zones just outside the silhouette. */
export const CUBE_NAV = { ring: 84, arrow: 22, zone: 18, zoneOffset: 7 } as const;
/** The bottom band of the stage that the history timeline overlays (part 12-6); nothing else is placed inside it. */
export const BAND = 46;
/** The XYZ triad at the bottom-left, just above the timeline band. */
export const TRIAD = { size: 56, left: 8, above: 6 } as const;
