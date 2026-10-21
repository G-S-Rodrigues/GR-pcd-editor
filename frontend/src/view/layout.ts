/** Pixel sizes of the corners of the stage, shared by the builders and the filter-box placement (one place, no drift). */
export const CUBE_STAGE = 80; // the ViewCube's own square (faces, ids cube-*)
export const CUBE_SIDE = 40; // px, the cube's edge length
/** The wrapper holds the cube in its middle and the six arrows and corner zones around it. */
export const CUBE_WRAP = 160;
export const CUBE_TOP = 8;
export const CUBE_RIGHT = 8;
/** The camera cluster: a row of four icon buttons above the ViewCube (part 16-2; it was under it in 12-3). */
export const CLUSTER = { btn: 32, between: 2, gap: 6, count: 4, w: 4 * 32 + 3 * 2, h: 32 } as const;
/** Top of the ViewCube wrapper: below the cluster row. */
export const CUBE_WRAP_TOP = CUBE_TOP + CLUSTER.h + CLUSTER.gap;
/** Reserved top-right rectangle: the cluster row plus the cube with its arrows below it. */
export const CUBE = { w: CUBE_WRAP + 2 * CUBE_RIGHT, h: CUBE_WRAP_TOP + CUBE_WRAP + 8 } as const;
/** Arrow ring and corner zones around the cube centre (px). Arrows sit on `ring`, corner zones just outside the silhouette. */
export const CUBE_NAV = { ring: 68, arrow: 22, zone: 18, zoneOffset: 5 } as const;
/** The legend/mode-line menu at the stage's top-left: its expanded box (px) and the clearance kept around it. */
export const LEGEND_BOX = { left: 8, top: 8, w: 224, maxH: 238, pad: 4 } as const;
/** The bottom band of the stage that the history timeline overlays (part 12-6); nothing else is placed inside it. */
export const BAND = 46;
/** The XYZ triad at the bottom-left, just above the timeline band. */
export const TRIAD = { size: 56, left: 8, above: 6 } as const;
