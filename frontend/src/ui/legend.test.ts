import { expect, test } from "vitest";
import { PALETTE } from "../colour/palette";
import { cssColour, legendEntries } from "./legend";

test("UI-128 legend entries are exactly the palette constants", () => {
  const e = legendEntries();
  expect(e.map((x) => x.id)).toEqual(["base", "selected", "protected", "slab", "deleted"]); // 7c-3: + slab (UI-171)
  expect(e.map((x) => x.label)).toEqual(["Unselected", "Candidate (will delete)", "Protected (kept)", "Protection slab", "Deleted overlay"]);
  for (const x of e) expect(x.colour).toBe(PALETTE[x.id as "base"]);
});

test("UI-171 the Protection slab entry uses the colour the slab outline is drawn in", () => {
  const slab = legendEntries().find((x) => x.id === "slab")!;
  expect(slab.label).toBe("Protection slab");
  expect(cssColour(slab.colour)).toBe("rgb(199, 125, 255)");
  // distinct from every other legend colour
  const others = legendEntries().filter((x) => x.id !== "slab").map((x) => cssColour(x.colour));
  expect(others).not.toContain(cssColour(slab.colour));
});

test("UI-128 css colour is rgb() of the palette triple", () => {
  expect(cssColour([1, 0, 0.5])).toBe("rgb(255, 0, 128)");
});
