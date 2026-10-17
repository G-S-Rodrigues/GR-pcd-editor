import { expect, test } from "vitest";
import { PRESET_ORDER } from "../view/presets";
import { VIEWCUBE, contrastRatio, rgbDistance } from "./palette";

test("UI-132 ViewCube palette: six distinct fills, labels readable at 4.5:1", () => {
  expect(Object.keys(VIEWCUBE).sort()).toEqual([...PRESET_ORDER].sort());
  const names = PRESET_ORDER;
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      expect(rgbDistance(VIEWCUBE[names[i]].fill, VIEWCUBE[names[j]].fill), `${names[i]}/${names[j]}`).toBeGreaterThanOrEqual(60);
    }
  }
  for (const n of names) expect(contrastRatio(VIEWCUBE[n].fill, VIEWCUBE[n].text), n).toBeGreaterThanOrEqual(4.5);
  expect(VIEWCUBE.top.fill).toBe("#4c78a8");
  expect(VIEWCUBE.right.fill).toBe("#e15759");
});

test("UI-132 contrast formula: black on white is 21, equal colours 1", () => {
  expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
  expect(contrastRatio("#4c78a8", "#4c78a8")).toBeCloseTo(1, 5);
});
