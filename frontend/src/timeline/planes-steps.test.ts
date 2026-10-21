import { expect, test } from "vitest";
import type { HistoryEntry } from "../state/types";
import { sessionFixture } from "../testing/fixtures";
import { iconFor, stepsOf } from "./model";

const sel = (i: number, shape: HistoryEntry["shape"], count = 37): HistoryEntry => ({ index: i, kind: "delete", description: "", count, sid: i + 1, tool: "selection", name: null, shape });

test("UI-966 a selection step made by Planes or Thin says Plane or Thin in its tooltip; the glyph stays other; a name wins", () => {
  const plane = { type: "plane" as const, normal: [0, 0, 1] as [number, number, number], d: 3, thickness: 0.03, exclude_protected: true, region: null };
  const thin = { type: "thin" as const, method: "duplicates" as const, distance: 0, edge: 0.05, exclude_protected: true, region: null };
  const steps = stepsOf(sessionFixture({ history: { entries: [sel(0, plane, 900), sel(1, thin), sel(2, null, 5), { ...sel(3, plane), name: "Ceiling" }], cursor: 4, can_undo: true, can_redo: false } }));
  expect(steps[0].tooltip).toMatch(/^Plane delete, 900 points\./);
  expect(steps[1].tooltip).toMatch(/^Thin delete, 37 points\./);
  expect(steps[2].tooltip).toMatch(/^Selection delete, 5 points\./);
  expect(steps[3].tooltip).toMatch(/^Ceiling delete, 37 points\./);
  expect(steps.map((s) => s.icon)).toEqual(["other", "other", "other", "other"]);
  expect(iconFor("selection")).toBe("other");
});
