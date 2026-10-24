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
/** The vertical camera stack (22-8) that will sit under the ViewCube: four 32 px buttons, 2 px between, 4 px glass padding each side. */
export const STACK = { w: 40, h: 4 * 32 + 3 * 2 + 8 } as const;
/** Reserved top-right column: the cube with its arrows, then the camera stack under it (22-8). It also covers today's row above the cube. */
export const CUBE = { w: CUBE_WRAP + 2 * CUBE_RIGHT, h: CUBE_TOP + CUBE_WRAP + CLUSTER.gap + STACK.h + 8 } as const;
/** Arrow ring and corner zones around the cube centre (px). Arrows sit on `ring`, corner zones just outside the silhouette. */
export const CUBE_NAV = { ring: 68, arrow: 22, zone: 18, zoneOffset: 5 } as const;
/** The floating tool palette (six icon buttons, 22-6) at the stage's top-left, and the arm pill beside it; both sit inside the corner the legend reserves. */
export const PALETTE = { left: 8, top: 8, w: 44, h: 236 } as const;
export const ARM_PILL = { left: 60, top: 8, h: 26, maxW: 180 } as const;
/** The corner the palette (and the arm pill beside it) reserves at the stage's top-left. */
export const PALETTE_CORNER = { w: ARM_PILL.left + ARM_PILL.maxW + 4, h: PALETTE.top + PALETTE.h + 4 } as const;
/** The thin timeline bar (22-8): 40 px tall, 8 px above the stage bottom. */
export const BAR = { h: 40, bottom: 8 } as const;
/** The bottom band of the stage that the history timeline overlays (part 12-6); nothing else is placed inside it. */
export const BAND = BAR.h + BAR.bottom;
/** The XYZ triad at the bottom-left, just above the timeline band. */
export const TRIAD = { size: 56, left: 8, above: 6 } as const;
/** The legend/mode-line menu at the stage's bottom-left (22-8), right of the triad and bottom-aligned with it: its expanded box (px) and the clearance kept around it. */
export const LEGEND_BOX = { left: TRIAD.left + TRIAD.size + 8, bottom: BAND + TRIAD.above, w: 224, maxH: 238, pad: 4 } as const;
/** The Reset filters icon (#filter-hud) at the stage's bottom-right, above the timeline bar. */
export const RESET_HUD = { right: 8, bottom: BAND + 8, size: 40 } as const;
/** The band-hidden pill (#band-pill, bottom centre, `bottom` px above the stage's edge): the box it reserves, a little larger than the pill itself (about 240 x 28). */
export const PILL = { w: 260, h: 34, bottom: 56 } as const;
