import { expect, test } from "vitest";
import { contrastRatio } from "../colour/palette";
import html from "../../index.html?raw";
const token = (name: string): string => {
  const m = html.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`token --${name} missing from index.html`);
  return m[1];
};

test("UI-306 text tokens read at 4.5:1 and icon, focus and pressed colours at 3:1 against the panel", () => {
  const panel = token("panel");
  expect(contrastRatio(token("text"), panel)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(token("muted"), panel)).toBeGreaterThanOrEqual(4.5);
  // an icon takes the text colour; the focus ring and the pressed outline are drawn against the panel
  expect(contrastRatio(token("text"), panel)).toBeGreaterThanOrEqual(3);
  expect(contrastRatio(token("focus"), panel)).toBeGreaterThanOrEqual(3);
  expect(contrastRatio(token("accent"), panel)).toBeGreaterThanOrEqual(3);
  // an icon on the pressed fill
  expect(contrastRatio(token("text"), "#2b4a7a")).toBeGreaterThanOrEqual(4.5);
});
