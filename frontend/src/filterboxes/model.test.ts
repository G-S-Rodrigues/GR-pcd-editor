import { describe, expect, it } from "vitest";
import { BOX_IDS, boxKey, isBoxCollapsed } from "./model";

describe("filter box collapse rule", () => {
  it("UI-888 an empty state collapses all six boxes; only an explicit false expands; a toggle writes explicit values", () => {
    const keys = BOX_IDS.map(boxKey);
    expect(keys).toHaveLength(6);
    expect(keys.map((k) => isBoxCollapsed({ collapsed: {} }, k))).toEqual([true, true, true, true, true, true]);
    const ui = { collapsed: { "x-min": false } as Record<string, boolean> };
    expect(keys.filter((k) => !isBoxCollapsed(ui, k))).toEqual(["x-min"]);
    expect(isBoxCollapsed({ collapsed: { "x-min": true } }, "x-min")).toBe(true);
    // the toggle in ui/filterboxes.ts writes !isBoxCollapsed: an untouched box becomes an explicit false, then true
    const first = !isBoxCollapsed({ collapsed: {} }, "z-max");
    expect(first).toBe(false);
    expect(!isBoxCollapsed({ collapsed: { "z-max": first } }, "z-max")).toBe(true);
  });
});
