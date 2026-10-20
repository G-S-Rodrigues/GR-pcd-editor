import { expect, test } from "vitest";
import type { RenderData } from "../render/parse";
import { applyHidden, emptyHidden, hiddenCount, hidePartialText, isHidden, stashSelected } from "./hidden";

/** Render of ids 10..(10+n-1); `flags[i]` as given. */
const render = (flags: number[], withAttr = false): RenderData => {
  const n = flags.length;
  const r: RenderData = {
    coords: Float32Array.from({ length: n * 3 }, (_, i) => i),
    ids: Uint32Array.from({ length: n }, (_, i) => 10 + i),
    flags: Uint8Array.from(flags),
    origin: [1, 2, 3],
    count: n,
    eligible: n + 5,
    cloudRevision: 4,
    paramsRevision: 5,
    sessionId: "s1",
  };
  if (withAttr) {
    r.attr = Float32Array.from({ length: n }, (_, i) => 100 + i);
    r.attrField = "intensity";
    r.attrKind = "f32";
  }
  return r;
};

test("UI-500 the empty set hides nothing and counts zero", () => {
  const h = emptyHidden();
  expect(hiddenCount(h)).toBe(0);
  expect(isHidden(h, 0)).toBe(false);
  expect(isHidden(h, 123456)).toBe(false);
});

test("UI-501 stashing keeps the ids that carried the selected or protected flag and is exact when they equal the selection count", () => {
  const r = render([0, 1, 2, 0, 1]); // ids 11, 12 (protected), 14
  const out = stashSelected(emptyHidden(), r, "s1", 100, 3);
  expect(out.flagged).toBe(3);
  expect(out.exact).toBe(true);
  expect(hiddenCount(out.hidden)).toBe(3);
  expect([10, 11, 12, 13, 14].map((id) => isHidden(out.hidden, id))).toEqual([false, true, true, false, true]);
  // a second stash adds to the first
  const more = stashSelected(out.hidden, render([1, 0, 0, 0, 0]), "s1", 100, 1);
  expect(hiddenCount(more.hidden)).toBe(4);
  expect(isHidden(more.hidden, 10)).toBe(true);
  expect(isHidden(more.hidden, 11)).toBe(true);
});

test("UI-502 a sample that holds fewer flagged points than the selection is not exact and the text says so", () => {
  const out = stashSelected(emptyHidden(), render([1, 1, 0]), "s1", 100, 1500);
  expect(out.flagged).toBe(2);
  expect(out.exact).toBe(false);
  const t = hidePartialText(out.flagged, 1500);
  expect(t).toContain("2");
  expect(t).toContain("1,500");
  expect(t).toMatch(/not hidden|still shown|display budget/i);
});

test("UI-503 applyHidden drops hidden points from coords, ids, flags and attr and lowers count and eligible", () => {
  const h = stashSelected(emptyHidden(), render([1, 0, 0, 0]), "s1", 100, 1).hidden; // hides id 10
  const out = applyHidden(render([0, 0, 1, 0], true), h);
  expect(out.count).toBe(3);
  expect(out.eligible).toBe(4 + 5 - 1);
  expect(Array.from(out.ids)).toEqual([11, 12, 13]);
  expect(Array.from(out.flags)).toEqual([0, 1, 0]);
  expect(Array.from(out.coords)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11]);
  expect(Array.from(out.attr ?? [])).toEqual([101, 102, 103]);
  expect(out.attr).toBeInstanceOf(Float32Array);
  expect(out.origin).toEqual([1, 2, 3]);
  expect(out.sessionId).toBe("s1");
  expect(out.cloudRevision).toBe(4);
});

test("UI-504 an empty set (or one that hides nothing in this render) returns the very same object", () => {
  const r = render([0, 1]);
  expect(applyHidden(r, emptyHidden())).toBe(r);
  const h = stashSelected(emptyHidden(), render([1]), "s1", 100, 1).hidden; // id 10
  const far: RenderData = { ...r, ids: Uint32Array.from([50, 51]) };
  expect(applyHidden(far, h)).toBe(far);
});
