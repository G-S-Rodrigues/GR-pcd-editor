import { expect, test } from "vitest";
import { contrastRatio } from "../colour/palette";
import { BAND } from "../view/layout";
import { TL_STYLE, blend, timelineCss } from "./overlay";

const css = timelineCss();
const rule = (sel: string): string => {
  const m = css.split("\n").find((l) => l.startsWith(sel + " {"));
  if (!m) throw new Error(`no rule for ${sel}`);
  return m;
};

test("UI-350 the strip is a transparent overlay on the stage's bottom edge that lets pointer events through", () => {
  const t = rule("#timeline");
  expect(t).toContain("position: absolute");
  expect(t).toContain("bottom: 0");
  expect(t).toContain(`height: ${BAND}px`);
  expect(t).toContain("background: transparent");
  expect(t).toContain("pointer-events: none");
  expect(t).not.toMatch(/border-top: 1px/);
  expect(rule("#timeline-scroll")).toContain("pointer-events: none");
  expect(rule("#timeline-track")).toContain("pointer-events: none");
  for (const sel of [".step", "#timeline-marker", ".tl-line"]) expect(rule(sel), sel).toContain("pointer-events: auto");
});

test("UI-351 step icons and counts read at 4.5:1 over a dark background and over bright points, and carry a halo", () => {
  for (const under of ["#15181d", "#000000", "#ffffff", "#ffd400", "#ff2a2a"]) {
    const card = blend(TL_STYLE.cardRgb, TL_STYLE.cardAlpha, under);
    expect(contrastRatio(TL_STYLE.text, card), `text over ${under}`).toBeGreaterThanOrEqual(4.5);
  }
  expect(rule(".step")).toContain("text-shadow");
  expect(rule(".tl-line::before")).toContain("box-shadow");
  expect(TL_STYLE.cardAlpha).toBeLessThan(1);
});

test("UI-353 the strip's transition is switched off for reduced motion", () => {
  expect(css).toMatch(/prefers-reduced-motion: reduce\) \{[^}]*\.step[^}]*transition: none/);
});
