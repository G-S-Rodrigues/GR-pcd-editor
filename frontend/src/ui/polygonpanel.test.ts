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
const scroller = { scrollTop: 40 };
const toolChanged = vi.fn();
const actions = new Proxy({ toolChanged } as Record<string, unknown>, { get: (t, k: string) => t[k] ?? (() => undefined) }) as unknown as PanelActions;
buildEditPanels(dom.root as unknown as HTMLElement, store, actions, { scroller });
const ctl = (id: string) => dom.root.control(id) as FakeEl;
const section = () => dom.root.all().find((e) => e.getAttribute("data-section") === "polygon") as FakeEl;

const closedSquare = () => {
  let p = startDrawing(emptyPolygon());
  for (const v of [[0, 0], [4, 0], [4, 4], [0, 4]] as [number, number][]) p = addVertex(p, v);
  return closePolygon(p).state;
};
beforeEach(() => {
  scroller.scrollTop = 40;
  toolChanged.mockClear();
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

test("UI-666 choosing the Polygon tool scrolls the panel to the top once per choice, not on every state change (the UI-891 behaviour)", () => {
  store.set({ tool: "polygon" });
  expect(scroller.scrollTop).toBe(0);
  scroller.scrollTop = 40;
  store.update((s) => ({ ...s, tools: { ...s.tools, polygon: closedSquare() } }));
  store.set({ scope: "active" });
  expect(scroller.scrollTop).toBe(40);
  store.set({ tool: "box" });
  scroller.scrollTop = 40;
  store.set({ tool: "polygon" });
  expect(scroller.scrollTop).toBe(0);
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

test("UI-1151 the Sparse radius field opens at 0.4 with the derive placeholder; clearing it stores null and the summary says it is derived", () => {
  store.set({ tool: "sparse" });
  const radius = ctl("sparse-radius");
  expect(radius.value).toBe("0.4");
  expect(radius.getAttribute("placeholder")).toBe("From point spacing");
  radius.value = "";
  radius.fire("change");
  expect(store.get().tools.sparse.radius).toBeNull();
  expect(radius.value).toBe("");
  const section = dom.root.all().find((e) => e.getAttribute("data-section") === "sparse") as FakeEl;
  expect(section.text()).toMatch(/radius from the point spacing/);
});

test("UI-683 the Sparse points section shows for its tool only, edits radius and neighbours with validation and re-selects", () => {
  const section = dom.root.all().find((e) => e.getAttribute("data-section") === "sparse") as FakeEl;
  expect(section.hidden).toBe(true);
  store.set({ tool: "sparse" });
  expect(section.hidden).toBe(false);
  expect(section.text()).toMatch(/fewer than 8 points/);
  const radius = ctl("sparse-radius");
  radius.value = "0.25";
  radius.fire("change");
  expect(store.get().tools.sparse.radius).toBe(0.25);
  radius.value = "";
  radius.fire("change");
  expect(store.get().tools.sparse.radius).toBeNull();
  radius.value = "abc";
  radius.fire("change");
  expect(store.get().tools.sparse.radius).toBeNull();
  expect(dom.root.all().find((e) => e.getAttribute("id") === "edit-error")?.text()).toMatch(/Radius/);
  const min = ctl("sparse-min");
  min.value = "3";
  min.fire("change");
  expect(store.get().tools.sparse.minNeighbours).toBe(3);
  expect(section.text()).toMatch(/fewer than 3 points/);
  min.value = "0";
  min.fire("change");
  expect(store.get().tools.sparse.minNeighbours).toBe(3);
  const calls = toolChanged.mock.calls.length;
  (ctl("sparse-exclude-protected") as unknown as { checked: boolean }).checked = false; // what a click does to a checkbox
  ctl("sparse-exclude-protected").fire("change");
  expect(toolChanged.mock.calls.length).toBe(calls + 1);
  expect(store.get().tools.sparse.excludeProtected).toBe(false);
});
