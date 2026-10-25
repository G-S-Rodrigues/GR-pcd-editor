import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { FILTER_COPY, filterSummary } from "../inspector/filters";
import { createAppStore } from "../state/app";
import { type FakeEl, installFakeDom } from "../testing/fakedom";
import { sessionFixture } from "../testing/fixtures";
import { describeControls } from "./describe";
import { buildFilterReset } from "./filterboxes";
import { type PanelActions, buildEditPanels } from "./panels";

const dom = installFakeDom();
afterAll(() => dom.restore());
const store = createAppStore();
const root = dom.root as unknown as HTMLElement & FakeEl;
const onReset = vi.fn();
buildFilterReset(root, store, onReset);
const btn = () => dom.root.all().find((e) => e.getAttribute("data-control") === "filter-reset-all") as FakeEl;
const twoSides = { x: { enabled: true, min: 5, max: 10 }, y: { enabled: false, min: 0, max: 0 }, z: { enabled: true, min: 0, max: 1.5 } };
beforeEach(() => {
  onReset.mockClear();
  store.set({ ...createAppStore().get(), session: sessionFixture() });
});

test("UI-1233 buildFilterReset puts the Reset filters icon button into the HUD: named, titled with the filter copy, the summary as its description, accent while a side is active, one click one reset, hidden without a session", () => {
  const b = btn();
  expect(b.children[0].tag).toBe("svg");
  expect(b.children[0].getAttribute("data-icon")).toBe("filterx");
  expect(b.getAttribute("aria-label")).toBe("Reset filters");
  expect(b.title).toContain(FILTER_COPY);
  expect(root.hidden).toBe(false);
  // none active
  expect(b.classList.contains("active")).toBe(false);
  expect(b.getAttribute("aria-description")).toMatch(/^0 filters active/);
  // two sides active
  store.update((s) => ({ ...s, tools: { ...s.tools, filters: twoSides } }));
  const s = store.get();
  expect(b.getAttribute("aria-description")).toBe(filterSummary(s.tools.filters, s.session!.bounds, s.session!.counts));
  expect(b.getAttribute("aria-description")).toMatch(/^2 filters active/);
  expect(b.classList.contains("active")).toBe(true);
  b.fire("click");
  expect(onReset).toHaveBeenCalledTimes(1);
  store.set({ session: null });
  expect(root.hidden).toBe(true);
});

test("UI-1234 the Display filter section is gone: buildEditPanels has no #display-filter and no filter-reset-all, and the control is registered exactly once", () => {
  const panels = new (dom.root.constructor as new (t: string) => FakeEl)("div");
  const actions = new Proxy({} as Record<string, unknown>, { get: () => () => undefined }) as unknown as PanelActions;
  buildEditPanels(panels as unknown as HTMLElement, createAppStore(), actions);
  expect(panels.all().some((e) => e.getAttribute("id") === "display-filter")).toBe(false);
  expect(panels.all().some((e) => e.getAttribute("data-control") === "filter-reset-all")).toBe(false);
  expect(describeControls().filter((c) => c.id === "filter-reset-all")).toHaveLength(1);
});
