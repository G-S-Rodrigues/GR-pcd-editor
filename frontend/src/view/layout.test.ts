import { expect, test } from "vitest";
import { LEGEND } from "../filterboxes/placement";
import { ARM_PILL, LEGEND_BOX, PALETTE } from "./layout";

const rect = (left: number, top: number, w: number, h: number) => ({ l: left, t: top, r: left + w, b: top + h });
const inside = (a: ReturnType<typeof rect>, b: { l: number; t: number; r: number; b: number }) => a.l >= b.l && a.t >= b.t && a.r <= b.r && a.b <= b.b;
const meets = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

test("UI-1164 the palette and the arm pill lie inside the reserved legend corner and clear of the legend box, which sits right and below them", () => {
  const corner = { l: 0, t: 0, r: LEGEND.w, b: LEGEND.h };
  const pal = rect(PALETTE.left, PALETTE.top, PALETTE.w, PALETTE.h);
  const pill = rect(ARM_PILL.left, ARM_PILL.top, ARM_PILL.maxW, ARM_PILL.h);
  const legend = rect(LEGEND_BOX.left, LEGEND_BOX.top, LEGEND_BOX.w, LEGEND_BOX.maxH);
  expect(inside(pal, corner)).toBe(true);
  expect(inside(pill, corner)).toBe(true);
  expect(meets(pal, legend)).toBe(false);
  expect(meets(pill, legend)).toBe(false);
  expect(meets(pal, pill)).toBe(false);
  expect(LEGEND_BOX.left).toBe(PALETTE.left + PALETTE.w + 8);
  expect(LEGEND_BOX.top).toBe(ARM_PILL.top + ARM_PILL.h + 6);
  expect(PALETTE).toEqual({ left: 8, top: 8, w: 44, h: 236 });
  expect(ARM_PILL).toEqual({ left: 60, top: 8, h: 26, maxW: 180 });
});
