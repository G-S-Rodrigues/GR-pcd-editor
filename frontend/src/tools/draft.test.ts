import { expect, test } from "vitest";
import { initialState } from "../state/app";
import { draftOutline, draftText } from "./draft";

test("UI-143 a drafted Add/Subtract/Intersect shape says it is a draft and never invents a count", () => {
  const s = { ...initialState(), op: "subtract" as const, draft: true, tool: "box" as const };
  const t = draftText(s)!;
  expect(t).toMatch(/draft, not yet applied/i);
  expect(t).toMatch(/subtract/i);
  expect(t).toMatch(/count is unknown/i);
  expect(t).not.toMatch(/\d/);
  expect(draftText({ ...s, draft: false })).toBeNull();
});

test("UI-143 the draft outline differs from the live-preview outline and the hint appears only for a draft", () => {
  const live = initialState();
  const d = { ...live, draft: true };
  expect(draftOutline(live)).toEqual({ draft: false, colour: 0xffd23f });
  expect(draftOutline(d).draft).toBe(true);
  expect(draftOutline(d).colour).not.toBe(0xffd23f);
});
