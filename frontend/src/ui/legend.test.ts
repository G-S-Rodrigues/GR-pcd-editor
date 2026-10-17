import { expect, test } from "vitest";
import { PALETTE } from "../colour/palette";
import { cssColour, legendEntries } from "./legend";

test("UI-128 legend entries are exactly the palette constants", () => {
  const e = legendEntries();
  expect(e.map((x) => x.id)).toEqual(["base", "selected", "protected", "deleted"]);
  expect(e.map((x) => x.label)).toEqual(["Unselected", "Candidate (will delete)", "Protected (kept)", "Deleted overlay"]);
  for (const x of e) expect(x.colour).toBe(PALETTE[x.id as "base"]);
});

test("UI-128 css colour is rgb() of the palette triple", () => {
  expect(cssColour([1, 0, 0.5])).toBe("rgb(255, 0, 128)");
});
