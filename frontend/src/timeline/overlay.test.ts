import { expect, test } from "vitest";
import { contrastRatio } from "../colour/palette";
import { type Theme, parseBlocks, parseColour, raw, solid } from "../testing/tokens";
import { BAND, BAR } from "../view/layout";
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

test("UI-351 step icons and counts read at 4.5:1 in both themes over the bar token and the chip fill, over a dark background and over bright points, and carry a halo", () => {
  const blocks = parseBlocks();
  for (const theme of ["dark", "light"] as const satisfies readonly Theme[]) {
    const bar = parseColour(raw(theme, "tl-bar", blocks));
    expect(bar.alpha, `--tl-bar alpha (${theme})`).toBeLessThan(1);
    for (const under of ["#15181d", "#000000", "#ffffff", "#ffd400", "#ff2a2a", "#e9ebef"]) {
      const onBar = blend(bar.hex, bar.alpha, under);
      const chip = solid(theme, "fill-1", onBar, blocks);
      const text = solid(theme, "tl-text", chip, blocks);
      expect(contrastRatio(text, chip), `${theme} text over ${under}`).toBeGreaterThanOrEqual(4.5);
    }
  }
  expect(rule(".step")).toContain("text-shadow");
  expect(rule(".tl-line::before")).toContain("box-shadow");
});

test("UI-1239 the thin bar: a 40 px glass strip 8 px above the stage bottom, 26 px single-line chips, the label hidden below 1700 px and shown (widening the chip over its neighbours) on hover or focus, the marker above them", () => {
  const bar = rule("#timeline-bar");
  expect(bar).toContain("position: absolute");
  expect(bar).toContain(`bottom: ${BAR.bottom}px`);
  expect(bar).toContain("height: 40px");
  expect(bar).toContain("background: var(--tl-bar)");
  expect(bar).toContain("pointer-events: none");
  expect(bar).toContain("border-radius: 12px");
  const step = rule(".step");
  expect(step).toContain("height: 26px");
  expect(step).toContain("white-space: nowrap");
  expect(step).toContain("pointer-events: auto");
  const narrow = css.split("\n").find((l) => l.startsWith("@media (max-width: 1699px)")) ?? "";
  expect(narrow).toMatch(/\.step \.step-label \{ display: none/);
  expect(narrow).toMatch(/\.step:hover \.step-label, \.step:focus-within \.step-label \{ display: inline/);
  expect(narrow).toMatch(/\.step:hover, \.step:focus-within \{[^}]*width: max-content !important[^}]*z-index: 3/);
  const wide = css.split("\n").find((l) => l.startsWith("@media (min-width: 1700px)")) ?? "";
  expect(wide).toMatch(/\.step \.step-label \{ display: inline/);
  const z = (sel: string) => Number(rule(sel).match(/z-index: (\d+)/)?.[1] ?? NaN);
  expect(z("#timeline-marker")).toBeGreaterThan(3);
  expect(rule(".tl-head")).toContain("pointer-events: none");
  expect(rule(".tl-end")).toContain("pointer-events: none");
  expect(rule(".tl-end #history-open")).toContain("pointer-events: auto");
  expect(rule("#timeline")).toContain(`height: ${BAND}px`);
});

test("UI-353 the strip's transition is switched off for reduced motion", () => {
  expect(css).toMatch(/prefers-reduced-motion: reduce\) \{[^}]*\.step[^}]*transition: none/);
});
