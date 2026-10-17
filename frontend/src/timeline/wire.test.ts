import { expect, test } from "vitest";
import { PALETTE } from "../colour/palette";
import { describeControls } from "../ui/describe";
import { legendEntries } from "../ui/legend";
import { MOUSE_DOCS, KEY_DOCS } from "../ui/keys";
import { TOOLTIPS } from "../ui/tooltips";

test("UI-277 the timeline region and its marker are registered controls with tooltips", () => {
  const ids = describeControls().map((c) => c.id);
  expect(ids).toContain("timeline");
  expect(ids).toContain("timeline-marker");
  expect(TOOLTIPS.timeline).toMatch(/history|step/i);
  expect(TOOLTIPS["timeline-marker"]).toMatch(/roll/i);
  expect(TOOLTIPS.timeline).not.toBe(TOOLTIPS["timeline-marker"]);
});

test("UI-278 the legend lists Step highlight only while a highlight is active; the static list is unchanged", () => {
  expect(legendEntries().map((e) => e.id)).toEqual(["base", "selected", "protected", "slab", "deleted"]);
  const on = legendEntries(true);
  expect(on.map((e) => e.id)).toEqual(["base", "selected", "protected", "slab", "deleted", "step"]);
  const step = on.find((e) => e.id === "step")!;
  expect(step.label).toBe("Step highlight");
  expect(step.colour).toBe(PALETTE.step);
});

test("UI-279 help lists the three timeline mouse rows and the key table is unchanged", () => {
  const keys = MOUSE_DOCS.map((d) => d.keys.toLowerCase()).join("|");
  expect(keys).toContain("timeline step");
  expect(keys).toContain("timeline marker");
  expect(keys).toContain("double-click a step name");
  expect(KEY_DOCS.map((d) => d.id)).toEqual([
    "view-1", "view-2", "view-3", "view-4", "view-5", "view-6", "perspective", "fit", "fit-selection", "hold-original", "rect",
    "slice-prev", "slice-next", "polygon-close", "cancel", "apply", "undo", "redo", "help",
  ]);
});
