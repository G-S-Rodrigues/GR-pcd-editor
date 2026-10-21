import { expect, test } from "vitest";
import { describeControls } from "./describe";
import { TOOLTIPS } from "./tooltips";

test("UI-205 the box controls are registered with their own tooltips; the panel filter controls are gone", () => {
  const ids = describeControls().map((c) => c.id);
  for (const a of ["x", "y", "z"]) {
    for (const s of ["min", "max"]) {
      for (const suffix of ["", "-grip", "-reset", "-toggle"]) {
        const id = `filter-${a}-${s}${suffix}`;
        expect(ids, id).toContain(id);
        expect(TOOLTIPS[id]?.trim(), id).toBeTruthy();
      }
    }
    expect(ids).not.toContain(`filter-${a}-enabled`);
    expect(ids).not.toContain(`filter-${a}-min-slider`);
    expect(ids).not.toContain(`filter-${a}-max-slider`);
  }
  expect(ids).toContain("filter-reset-all");
  expect(ids).not.toContain("filter-reset-bounds");
  expect(TOOLTIPS["filter-z-max-grip"]).toMatch(/drag/i);
  expect(TOOLTIPS["filter-z-min-reset"]).toMatch(/cloud/i);
});
