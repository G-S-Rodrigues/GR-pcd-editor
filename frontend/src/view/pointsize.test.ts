import { expect, test } from "vitest";
import { createAppStore } from "../state/app";
import { lodLabel } from "../render/lod";
import { AUTO_BUDGET, pointSizeFor } from "./pointsize";

test("UI-129 label says sampled to budget, with flagged extras still counted", () => {
  expect(lodLabel({ count: 1_000_000, eligible: 3_000_000, budget: 1_000_000 })).toBe("Rendered 1,000,000 of 3,000,000 eligible (sampled to budget)");
  expect(lodLabel({ count: 1_200_000, eligible: 3_000_000, budget: 1_000_000 })).toContain("(sampled to budget)");
  expect(lodLabel({ count: 90, eligible: 90, budget: 100 })).toBe("Rendered all 90 eligible points");
});

test("UI-129 pointSizeFor grows with zoom and is clamped to the slider range", () => {
  expect(pointSizeFor(1)).toBe(1);
  expect(pointSizeFor(1e9)).toBe(10);
  expect(pointSizeFor(40)).toBe(4);
  expect(pointSizeFor(45)).toBe(4.5);
  expect(pointSizeFor(Number.NaN)).toBe(3);
  expect(pointSizeFor(100)).toBeGreaterThan(pointSizeFor(50));
});

test("UI-129 default draw budget is 1,000,000 and Auto is the 2,000,000 maximum", () => {
  expect(createAppStore().get().budget).toBe(1_000_000);
  expect(AUTO_BUDGET).toBe(2_000_000);
});
