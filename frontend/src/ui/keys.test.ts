import { expect, test } from "vitest";
import { PRESET_ORDER } from "../view/presets";
import { describeControls } from "./describe";
import { VIEW_KEYS, presetForKey } from "./keys";
import { TOOLTIPS } from "./tooltips";

test("UI-133 keys 1-6 map to the six presets in order", () => {
  expect(VIEW_KEYS.map((k) => k.key)).toEqual(["1", "2", "3", "4", "5", "6"]);
  PRESET_ORDER.forEach((p, i) => expect(presetForKey(String(i + 1))).toBe(p));
  expect(presetForKey("7")).toBeNull();
  expect(presetForKey("a")).toBeNull();
});

test("UI-133 the six view buttons are gone; the six ViewCube faces are described and have tooltips", () => {
  const ids = describeControls().map((c) => c.id);
  for (const p of PRESET_ORDER) {
    expect(ids).not.toContain(`view-${p}`);
    expect(TOOLTIPS[`view-${p}`]).toBeUndefined();
    expect(ids).toContain(`cube-${p}`);
    expect(TOOLTIPS[`cube-${p}`]).toMatch(/key [1-6]/);
  }
  expect(ids).toContain("view-perspective");
});
