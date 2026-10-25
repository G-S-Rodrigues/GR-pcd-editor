import { expect, test } from "vitest";
import { contrastRatio } from "../colour/palette";
import { onSurface, solid, surface } from "../testing/tokens";

/** The panel the side panels sit on: `--glass` over the dark theme's `--canvas`. */
const panel = (): string => surface("dark", "glass", "canvas");

test("UI-306 text tokens read at 4.5:1 and icon, focus and pressed colours at 3:1 against the panel", () => {
  const bg = panel();
  expect(contrastRatio(onSurface("dark", "label", "glass", "canvas"), bg)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(onSurface("dark", "label-2", "glass", "canvas"), bg)).toBeGreaterThanOrEqual(4.5);
  // an icon takes the text colour; the focus ring and the pressed border are drawn against the panel
  expect(contrastRatio(onSurface("dark", "label", "glass", "canvas"), bg)).toBeGreaterThanOrEqual(3);
  expect(contrastRatio(solid("dark", "focus"), bg)).toBeGreaterThanOrEqual(3);
  expect(contrastRatio(solid("dark", "accent"), bg)).toBeGreaterThanOrEqual(3);
  // an icon on the pressed fill
  const pressed = solid("dark", "accent-soft", bg);
  expect(contrastRatio(solid("dark", "label", pressed), pressed)).toBeGreaterThanOrEqual(4.5);
});

test("UI-620 the Delete button reads: its text at 4.5:1 on the destructive fill and the fill at 3:1 against the panel", () => {
  expect(contrastRatio(solid("dark", "on-destructive"), solid("dark", "destructive"))).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(solid("dark", "destructive"), panel())).toBeGreaterThanOrEqual(3);
  // and it is clearly red: the red channel dominates
  const d = solid("dark", "destructive");
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(d.slice(i, i + 2), 16));
  expect(r).toBeGreaterThan(g + 80);
  expect(r).toBeGreaterThan(b + 80);
});
