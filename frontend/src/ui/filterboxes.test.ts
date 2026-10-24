import { afterAll, expect, test, vi } from "vitest";
import { createAppStore } from "../state/app";
import { sessionFixture } from "../testing/fixtures";
import { type FakeEl, installFakeDom } from "../testing/fakedom";
import { INDEX_HTML } from "../testing/tokens";
import { buildFilterBoxes } from "./filterboxes";

const dom = installFakeDom();
(globalThis as Record<string, unknown>).ResizeObserver = class {
  observe(): void {}
};
afterAll(() => dom.restore());

test("UI-889 at open every filter box is collapsed (class, aria-expanded false, a chip such as X ≥ 0), and a toggle expands exactly that box", () => {
  const store = createAppStore();
  store.set({ session: sessionFixture() });
  const layer = Object.assign(new (dom.root.constructor as new (t: string) => FakeEl)("div"), { clientWidth: 800, clientHeight: 600 });
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) };
  buildFilterBoxes(layer as unknown as HTMLElement, canvas as unknown as HTMLCanvasElement, store, { editSide: () => ({ ok: true }) as never, resetSide: () => ({ ok: true }) as never });
  const boxes = layer.children;
  expect(boxes).toHaveLength(6);
  for (const b of boxes) {
    expect(b.className).toContain("collapsed");
    const tog = b.all().find((e) => (e.getAttribute("data-control") ?? "").endsWith("-toggle")) as FakeEl;
    expect(tog.getAttribute("aria-expanded")).toBe("false");
    expect(tog.text()).toMatch(/^[XYZ] (≥|≤) /);
  }
  const first = boxes[0].all().find((e) => (e.getAttribute("data-control") ?? "").endsWith("-toggle")) as FakeEl;
  first.fire("click");
  expect(boxes.filter((b) => !b.className.includes("collapsed"))).toHaveLength(1);
  expect(first.getAttribute("aria-expanded")).toBe("true");
});

test("UI-1100 a collapsed filter toggle's accessible name contains its visible chip text (WCAG 2.5.3) and the axis and side; expanded it is the plain box name", async () => {
  vi.resetModules(); // the control registry is module-global and UI-889 already built these ids
  const { buildFilterBoxes } = await import("./filterboxes");
  const store = createAppStore();
  store.set({ session: sessionFixture() });
  const layer = Object.assign(new (dom.root.constructor as new (t: string) => FakeEl)("div"), { clientWidth: 800, clientHeight: 600 });
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) };
  buildFilterBoxes(layer as unknown as HTMLElement, canvas as unknown as HTMLCanvasElement, store, { editSide: () => ({ ok: true }) as never, resetSide: () => ({ ok: true }) as never });
  const toggleOf = (id: string) => layer.children.flatMap((b) => b.all()).find((e) => e.getAttribute("data-control") === id) as FakeEl;
  for (const b of layer.children) {
    const tog = b.all().find((e) => (e.getAttribute("data-control") ?? "").endsWith("-toggle")) as FakeEl;
    expect(tog.getAttribute("aria-label")).toContain(tog.textContent);
    expect(tog.getAttribute("aria-label")).toContain(`${b.getAttribute("data-axis")!.toUpperCase()} ${b.getAttribute("data-side")}`);
  }
  // the fake DOM keeps the build-time text node, so the chip is read from textContent, not text()
  const xmin = toggleOf("filter-x-min-toggle");
  expect(xmin.textContent).toMatch(/^X ≥ /);
  expect(xmin.getAttribute("aria-label")).toContain("X min");
  xmin.fire("click");
  expect(xmin.textContent).toBe("–");
  expect(xmin.getAttribute("aria-label")).toBe("X min filter box");
  xmin.fire("click");
  expect(xmin.getAttribute("aria-label")).toContain(xmin.textContent);
});

test("UI-1235 the filter boxes are glass pills on tokens only: radius 9, the glass fill, a token border, no hex colour, the sizes the placement relies on unchanged (156x28, collapsed 76x24), and the chip reads with ≤ and ≥", async () => {
  const css = [...INDEX_HTML.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
  const fbox = rules.filter((r) => /^\.fbox\b/.test(r.selector));
  const own = fbox.find((r) => r.selector === ".fbox")!.body;
  expect(own).toMatch(/border-radius:\s*9px/);
  expect(own).toMatch(/background:\s*var\(--glass-hud\)/);
  expect(own).toMatch(/border:\s*1px solid var\(--separator\)/);
  expect(own).toMatch(/width:\s*156px/);
  expect(own).toMatch(/height:\s*28px/);
  const collapsed = fbox.find((r) => r.selector === ".fbox.collapsed")!.body;
  expect(collapsed).toMatch(/width:\s*76px/);
  expect(collapsed).toMatch(/height:\s*24px/);
  for (const r of fbox) expect(r.body, r.selector).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  const { boxView } = await import("../filterboxes/view");
  const { emptyFilter, setSide } = await import("../inspector/filters");
  const b = { min: [0, -5, 2], max: [10, 5, 12] } as never;
  const m = setSide(emptyFilter(), b, "z", "max", 2.45).model;
  expect(boxView(m, b, "z", "max", true).chipText).toBe("Z ≤ 2.45");
  expect(boxView(m, b, "z", "min", true).chipText).toBe("Z ≥ 2");
});
