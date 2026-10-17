import { expect, test } from "vitest";
import { createRegistry } from "./controls";
import { describeControls } from "./describe";
import { TOOLTIPS } from "./tooltips";

test("UI-25 registry rejects an empty tooltip and duplicate ids", () => {
  const r = createRegistry();
  r.register({ id: "a", tooltip: "Does a" });
  expect(() => r.register({ id: "b", tooltip: "" })).toThrow(/tooltip/);
  expect(() => r.register({ id: "c", tooltip: "   " })).toThrow(/tooltip/);
  expect(() => r.register({ id: "a", tooltip: "again" })).toThrow(/duplicate/);
  expect(r.ids()).toEqual(["a"]);
});

test("UI-26 every described control has a distinct non-empty tooltip entry", () => {
  const ids = describeControls().map((c) => c.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.length).toBeGreaterThan(15);
  for (const id of ids) expect(TOOLTIPS[id]?.trim(), id).toBeTruthy();
  const texts = ids.map((id) => TOOLTIPS[id]);
  expect(new Set(texts).size).toBe(texts.length);
  for (const id of Object.keys(TOOLTIPS)) expect(ids, `orphan tooltip ${id}`).toContain(id);
});
