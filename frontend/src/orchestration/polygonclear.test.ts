import { describe, expect, it, vi } from "vitest";
import { createClearPolygon } from "./polygonclear";

describe("clear polygon", () => {
  const mk = (selected: boolean) => {
    const calls: string[] = [];
    const clear = createClearPolygon({
      emptyPolygon: () => void calls.push("empty"),
      polygonSelected: () => selected,
      resetRunner: () => void calls.push("reset"),
      clearSelection: vi.fn(() => void calls.push("backend")),
    });
    return { calls, clear };
  };
  it("UI-113 clearing a polygon whose selection is showing also clears that selection", () => {
    const { calls, clear } = mk(true);
    clear();
    expect(calls).toEqual(["empty", "reset", "backend"]);
  });
  it("UI-113 clearing a polygon with no selection from it leaves the selection alone", () => {
    const { calls, clear } = mk(false);
    clear();
    expect(calls).toEqual(["empty", "reset"]);
  });
});
