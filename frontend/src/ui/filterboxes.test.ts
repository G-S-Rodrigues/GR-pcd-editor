import { afterAll, expect, test, vi } from "vitest";
import { createAppStore } from "../state/app";
import { sessionFixture } from "../testing/fixtures";
import { type FakeEl, installFakeDom } from "../testing/fakedom";
import { buildFilterBoxes } from "./filterboxes";

const dom = installFakeDom();
(globalThis as Record<string, unknown>).ResizeObserver = class {
  observe(): void {}
};
afterAll(() => dom.restore());

test("UI-889 at open every filter box is collapsed (class, aria-expanded false, a chip such as X>= 0), and a toggle expands exactly that box", () => {
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
    expect(tog.text()).toMatch(/^[XYZ](>=|<=) /);
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
  expect(xmin.textContent).toMatch(/^X>= /);
  expect(xmin.getAttribute("aria-label")).toContain("X min");
  xmin.fire("click");
  expect(xmin.textContent).toBe("–");
  expect(xmin.getAttribute("aria-label")).toBe("X min filter box");
  xmin.fire("click");
  expect(xmin.getAttribute("aria-label")).toContain(xmin.textContent);
});
