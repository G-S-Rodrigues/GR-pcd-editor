import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { createAppStore } from "../state/app";
import { sessionFixture } from "../testing/fixtures";
import { type FakeEl, installFakeDom } from "../testing/fakedom";
import { addVertex, closePolygon, emptyPolygon, startDrawing } from "../tools/polygon/model";
import { type PanelActions, buildEditPanels } from "./panels";
import { describeControls } from "./describe";
import { TOOLTIPS } from "./tooltips";

// the control registry rejects a second build of the same ids: build once, reset the state per test
const dom = installFakeDom();
afterAll(() => dom.restore());
const store = createAppStore();
const scroll = vi.fn();
const actions = new Proxy({} as Record<string, unknown>, { get: (t, k: string) => t[k] ?? (() => undefined) }) as unknown as PanelActions;
buildEditPanels(dom.root as unknown as HTMLElement, store, actions);
const ctl = (id: string) => dom.root.control(id) as FakeEl;
const section = () => dom.root.all().find((e) => e.getAttribute("data-section") === "polygon") as FakeEl;
(section() as unknown as { scrollIntoView: unknown }).scrollIntoView = scroll;

const closedSquare = () => {
  let p = startDrawing(emptyPolygon());
  for (const v of [[0, 0], [4, 0], [4, 4], [0, 4]] as [number, number][]) p = addVertex(p, v);
  return closePolygon(p).state;
};
beforeEach(() => {
  scroll.mockClear();
  store.set({ ...createAppStore().get(), session: sessionFixture(), tool: "none" });
});

test("UI-665 poly-edit is a described pencil toggle, enabled only for a closed polygon, and it flips the edit flag", () => {
  const b = ctl("poly-edit");
  expect(describeControls().find((d) => d.id === "poly-edit")?.label).toBe("Edit polygon vertices");
  expect(TOOLTIPS["poly-edit"]).toMatch(/Backspace/);
  expect(b.getAttribute("aria-label")).toBe("Edit polygon vertices");
  expect(b.children.map((c) => c.tag)).toEqual(["svg"]);
  store.set({ tool: "polygon" });
  expect(b.disabled).toBe(true); // nothing drawn yet
  store.update((s) => ({ ...s, tools: { ...s.tools, polygon: closedSquare() } }));
  expect(b.disabled).toBe(false);
  expect(b.getAttribute("aria-pressed")).toBe("false");
  b.fire("click");
  expect(store.get().tools.polygon.editing).toBe(true);
  expect(b.getAttribute("aria-pressed")).toBe("true");
  b.fire("click");
  expect(store.get().tools.polygon.editing).toBe(false);
  // drawing again leaves the mode and the button is disabled while drawing
  b.fire("click");
  store.update((s) => ({ ...s, tools: { ...s.tools, polygon: startDrawing(s.tools.polygon) } }));
  expect(store.get().tools.polygon.editing).toBe(false);
  expect(b.disabled).toBe(true);
});

test("UI-666 the Draw polygon button is highlighted until a polygon exists; the hint walks the three steps", () => {
  store.set({ tool: "polygon" });
  expect(ctl("poly-draw").classList.contains("hint")).toBe(true);
  expect(section().text()).toMatch(/1 Press Draw polygon/);
  store.update((s) => ({ ...s, tools: { ...s.tools, polygon: closedSquare() } }));
  expect(ctl("poly-draw").classList.contains("hint")).toBe(false);
  expect(section().text()).toMatch(/pencil/);
});

test("UI-666 choosing the Polygon tool scrolls its section to the top once, not on every state change", () => {
  store.set({ tool: "polygon" });
  expect(scroll).toHaveBeenCalledTimes(1);
  expect(scroll.mock.calls[0][0]).toMatchObject({ block: "start" });
  store.update((s) => ({ ...s, tools: { ...s.tools, polygon: closedSquare() } }));
  store.set({ scope: "active" });
  expect(scroll).toHaveBeenCalledTimes(1);
  store.set({ tool: "box" });
  store.set({ tool: "polygon" });
  expect(scroll).toHaveBeenCalledTimes(2);
});

test("UI-665 in edit mode each vertex row has a remove button that removes that vertex and nothing below three", () => {
  store.set({ tool: "polygon" });
  store.update((s) => ({ ...s, tools: { ...s.tools, polygon: { ...closedSquare(), editing: true } } }));
  const rm = (i: number) => dom.root.all().find((e) => e.getAttribute("data-vertex-remove") === String(i)) as FakeEl;
  expect(rm(0)).toBeDefined();
  rm(2).fire("click");
  expect(store.get().tools.polygon.vertices).toEqual([[0, 0], [4, 0], [0, 4]]);
  expect(dom.root.all().filter((e) => e.hasAttribute("data-vertex-remove"))).toHaveLength(3);
  rm(0).fire("click");
  expect(store.get().tools.polygon.vertices).toHaveLength(3); // refused
  expect(ctl("edit-error")).toBeUndefined(); // the shared error box is a plain div, not a control
  store.update((s) => ({ ...s, tools: { ...s.tools, polygon: { ...s.tools.polygon, editing: false } } }));
  expect(dom.root.all().filter((e) => e.hasAttribute("data-vertex-remove"))).toHaveLength(0);
});
