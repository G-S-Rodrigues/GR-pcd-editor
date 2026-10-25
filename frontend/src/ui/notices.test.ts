import { afterAll, expect, test, vi } from "vitest";
import { installFakeDom } from "../testing/fakedom";
import { INDEX_HTML } from "../testing/tokens";
import { noticeEl } from "./notices";

const dom = installFakeDom();
afterAll(() => dom.restore());
const n = (level: "info" | "warn" | "error") => ({ id: 7, level, code: "c", text: `a ${level} toast` });

test("UI-1237 a toast is a glass card with a level icon and the text unchanged: error is an alert, the rest are status; one click dismisses it once; the CSS gives it a 12 px radius, a shadow and no left border", () => {
  const dismiss = vi.fn();
  for (const level of ["info", "warn", "error"] as const) {
    const el = noticeEl(n(level), dismiss) as unknown as ReturnType<typeof dom.root.all>[number];
    expect(el.className).toBe(`notice ${level}`);
    expect(el.getAttribute("role")).toBe(level === "error" ? "alert" : "status");
    expect(el.getAttribute("title")).toBe("Click to dismiss");
    expect(el.children[0].tag).toBe("svg");
    expect(el.children[1].tag).toBe("span");
    expect(el.text()).toBe(`a ${level} toast`);
  }
  const el = noticeEl(n("warn"), dismiss) as unknown as { fire: (t: string) => void };
  el.fire("click");
  expect(dismiss).toHaveBeenCalledTimes(1);
  expect(dismiss).toHaveBeenCalledWith(7);
  const css = [...INDEX_HTML.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
  const rule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) => m[1].trim() === ".notice")?.[2] ?? "";
  expect(rule).toMatch(/border-radius:\s*12px/);
  expect(rule).toMatch(/box-shadow:\s*var\(--shadow\)/);
  expect(rule).toMatch(/display:\s*flex/);
  expect(rule).not.toMatch(/border-left/);
  const notices = css.match(/#notices\s*\{[^}]*\}/)?.[0] ?? "";
  expect(notices).toMatch(/top:\s*80px/);
});
