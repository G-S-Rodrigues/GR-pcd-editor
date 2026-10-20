import { afterAll, expect, test } from "vitest";
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
