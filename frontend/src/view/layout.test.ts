import { expect, test } from "vitest";
import { legendRect } from "../filterboxes/placement";
import { ARM_PILL, BAND, BAR, CLUSTER, CUBE, CUBE_RIGHT, CUBE_TOP, CUBE_WRAP, LEGEND_BOX, PALETTE, PALETTE_CORNER, RESET_HUD, STACK, TRIAD } from "./layout";

const rect = (left: number, top: number, w: number, h: number) => ({ l: left, t: top, r: left + w, b: top + h });
const inside = (a: ReturnType<typeof rect>, b: { l: number; t: number; r: number; b: number }) => a.l >= b.l && a.t >= b.t && a.r <= b.r && a.b <= b.b;
const meets = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

test("UI-1164 the palette and the arm pill lie inside the reserved palette corner and clear of the legend rectangle, which sits at the bottom left", () => {
  const corner = { l: 0, t: 0, r: PALETTE_CORNER.w, b: PALETTE_CORNER.h };
  const pal = rect(PALETTE.left, PALETTE.top, PALETTE.w, PALETTE.h);
  const pill = rect(ARM_PILL.left, ARM_PILL.top, ARM_PILL.maxW, ARM_PILL.h);
  const legend = legendRect({ w: 768, h: 642 }); // 1280x720 under R22-16
  expect(inside(pal, corner)).toBe(true);
  expect(inside(pill, corner)).toBe(true);
  expect(meets(pal, legend)).toBe(false);
  expect(meets(pill, legend)).toBe(false);
  expect(meets(corner, legend)).toBe(false);
  expect(meets(pal, pill)).toBe(false);
  expect(PALETTE).toEqual({ left: 8, top: 8, w: 44, h: 236 });
  expect(ARM_PILL).toEqual({ left: 60, top: 8, h: 26, maxW: 180 });
});

test("UI-1231 22-8 layout constants: BAND is the 40 px bar + 8; the legend sits right of the triad, bottom-aligned with it; Reset bottom right above the band; palette corner; the camera stack column", () => {
  expect(BAR).toEqual({ h: 40, bottom: 8 });
  expect(BAND).toBe(BAR.h + BAR.bottom);
  expect(BAND).toBe(48);
  expect(LEGEND_BOX.left).toBe(TRIAD.left + TRIAD.size + 8);
  expect(LEGEND_BOX.bottom).toBe(BAND + TRIAD.above);
  expect(LEGEND_BOX.w).toBe(224);
  expect(LEGEND_BOX.maxH).toBe(238);
  expect(RESET_HUD).toEqual({ right: 8, bottom: BAND + 8, size: 40 });
  expect(PALETTE_CORNER).toEqual({ w: ARM_PILL.left + ARM_PILL.maxW + 4, h: PALETTE.top + PALETTE.h + 4 });
  expect(STACK).toEqual({ w: 40, h: 4 * 32 + 3 * 2 + 8 });
  expect(CUBE.h).toBe(CUBE_TOP + CUBE_WRAP + CLUSTER.gap + STACK.h + 8);
  expect(CUBE.w).toBe(CUBE_WRAP + 2 * CUBE_RIGHT);
});
