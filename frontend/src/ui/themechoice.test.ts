import { expect, test } from "vitest";
import { THEME_KEY, applyTheme, readTheme, writeTheme } from "./themechoice";

const mem = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

test("UI-1133 the theme choice reads, writes and applies: a missing, auto, garbage or throwing store means system; system removes the key and the attribute", () => {
  expect(THEME_KEY).toBe("gr-pcd-editor.theme");
  const s = mem();
  expect(readTheme(s)).toBe("system");
  for (const bad of ["auto", "", "LIGHT", "{}"]) {
    s.m.set(THEME_KEY, bad);
    expect(readTheme(s), bad).toBe("system");
  }
  const throwing = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => { throw new Error("denied"); } };
  expect(readTheme(throwing)).toBe("system");
  expect(() => writeTheme(throwing, "light")).not.toThrow();
  expect(() => writeTheme(throwing, "system")).not.toThrow();
  for (const c of ["light", "dark"] as const) {
    writeTheme(s, c);
    expect(s.m.get(THEME_KEY)).toBe(c);
    expect(readTheme(s)).toBe(c);
  }
  writeTheme(s, "system");
  expect(s.m.has(THEME_KEY)).toBe(false);
  const el = { attrs: new Map<string, string>(), setAttribute(k: string, v: string) { this.attrs.set(k, v); }, removeAttribute(k: string) { this.attrs.delete(k); } };
  applyTheme(el, "light");
  expect(el.attrs.get("data-theme")).toBe("light");
  applyTheme(el, "dark");
  expect(el.attrs.get("data-theme")).toBe("dark");
  applyTheme(el, "system");
  expect(el.attrs.has("data-theme")).toBe(false);
});
