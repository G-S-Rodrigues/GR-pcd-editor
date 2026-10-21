import { expect, test } from "vitest";
import { dataModeModel } from "./datamode";

test("UI-310 dataModeModel: four items in order, exactly one pressed, all disabled without a session", () => {
  for (const mode of ["original", "edited", "overlay", "split"] as const) {
    const m = dataModeModel(mode, true);
    expect(m.items.map((i) => i.mode)).toEqual(["original", "edited", "overlay", "split"]);
    expect(m.items.map((i) => i.icon)).toEqual(["orig", "edit", "ovl", "split"]);
    expect(m.items.filter((i) => i.pressed).map((i) => i.mode)).toEqual([mode]);
    expect(m.items.every((i) => !i.disabled)).toBe(true);
    expect(m.showOpacity).toBe(mode === "overlay");
  }
  const none = dataModeModel("edited", false);
  expect(none.items.every((i) => i.disabled)).toBe(true);
  expect(none.showOpacity).toBe(false);
});
