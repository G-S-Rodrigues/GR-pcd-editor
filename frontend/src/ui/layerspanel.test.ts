import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { createAppStore } from "../state/app";
import { sessionFixture } from "../testing/fixtures";
import { type FakeEl, installFakeDom } from "../testing/fakedom";
import type { Layer } from "../state/types";
import { type PanelActions, buildEditPanels } from "./panels";
import { describeControls } from "./describe";
import { SECTION_IDS } from "./sections";
import { TOOLTIPS } from "./tooltips";

// the control registry rejects a second build of the same ids: build once, reset the state per test
const dom = installFakeDom();
afterAll(() => dom.restore());
const store = createAppStore();
const calls = { create: vi.fn(), assign: vi.fn(), release: vi.fn(), select: vi.fn(), toggle: vi.fn(), toMain: vi.fn(), choose: vi.fn() };
const actions = new Proxy(
  { layerCreate: calls.create, layerAssign: calls.assign, layerRelease: calls.release, layerSelect: calls.select, layerToggle: calls.toggle, layerToMain: calls.toMain, layerChoose: calls.choose } as Record<string, unknown>,
  { get: (t, k: string) => t[k] ?? (() => undefined) },
) as unknown as PanelActions;
buildEditPanels(dom.root as unknown as HTMLElement, store, actions);
const ctl = (id: string) => dom.root.control(id) as FakeEl;
const section = () => dom.root.all().find((e) => e.getAttribute("data-section") === "layers") as FakeEl;
const rows = () => section().all().filter((e) => e.getAttribute("data-layer-row") !== null);
const rowBtn = (id: number, kind: string) => section().all().find((e) => e.getAttribute(`data-layer-${kind}`) === String(id)) as FakeEl;

const layer = (over: Partial<Layer>): Layer => ({ id: 1, name: "Floor", colour: 0, visible: true, count: 30, bounds: null, ...over });
const base = (layers: Layer[], selected = 4) =>
  sessionFixture({ selection: { count: selected, ops: [] }, layers, counts: { ...sessionFixture().counts, main: 50 } });

beforeEach(() => {
  for (const c of Object.values(calls)) c.mockClear();
  store.set({ ...createAppStore().get(), session: base([layer({}), layer({ id: 2, name: "Wall", colour: 1, visible: false, count: 20 })]) });
});

test("UI-831 the layers section is a registered fold section, hidden without a file, shown with one", () => {
  expect(SECTION_IDS).toContain("layers");
  expect(SECTION_IDS.indexOf("layers")).toBeLessThan(SECTION_IDS.indexOf("history"));
  expect(section().hidden).toBe(false);
  store.set({ session: null });
  expect(section().hidden).toBe(true);
});

test("UI-832 one row per layer: colour chip, name with count, eye with aria-pressed and a label, Select and To main; Main is listed first", () => {
  expect(rows().map((r) => r.text())).toEqual(expect.arrayContaining([expect.stringContaining("Main (50)")]));
  const floor = rows().find((r) => r.getAttribute("data-layer-row") === "1") as FakeEl;
  expect(floor.text()).toContain("Floor (30)");
  expect(rowBtn(1, "eye").getAttribute("aria-pressed")).toBe("true");
  expect(rowBtn(1, "eye").getAttribute("aria-label")).toBe("Hide layer Floor");
  expect(rowBtn(2, "eye").getAttribute("aria-pressed")).toBe("false");
  expect(rowBtn(2, "eye").getAttribute("aria-label")).toBe("Show layer Wall");
  rowBtn(1, "eye").fire("click");
  rowBtn(1, "select").fire("click");
  rowBtn(1, "tomain").fire("click");
  expect(calls.toggle).toHaveBeenCalledWith(1);
  expect(calls.select).toHaveBeenCalledWith(1);
  expect(calls.toMain).toHaveBeenCalledWith(1);
});

test("UI-833 Select is inactive for a hidden layer with the title Show the layer first", () => {
  expect(rowBtn(2, "select").getAttribute("aria-disabled")).toBe("true");
  expect(rowBtn(2, "select").title).toContain("Show the layer first");
  expect(rowBtn(1, "select").getAttribute("aria-disabled")).toBe("false");
});

test("UI-834 clicking a row chooses it (aria-selected) and the Assign button then targets it", () => {
  expect(ctl("layer-assign").getAttribute("aria-disabled")).toBe("true");
  expect(ctl("layer-assign").title).toContain("Click a layer row to choose it first");
  const floor = rows().find((r) => r.getAttribute("data-layer-row") === "1") as FakeEl;
  floor.fire("click");
  expect(calls.choose).toHaveBeenCalledWith(1);
  store.set({ layerUi: { editing: null, active: 1 } });
  expect(rows().find((r) => r.getAttribute("data-layer-row") === "1")?.getAttribute("aria-selected")).toBe("true");
  expect(ctl("layer-assign").getAttribute("aria-disabled")).toBe("false");
  ctl("layer-assign").fire("click");
  expect(calls.assign).toHaveBeenCalledTimes(1);
});

test("UI-835 New layer passes the typed name and empties the field; the name field is limited to 40 characters", () => {
  expect(ctl("layer-name").getAttribute("maxlength")).toBe("40");
  ctl("layer-name").value = "Pipes";
  ctl("layer-new").fire("click");
  expect(calls.create).toHaveBeenCalledWith("Pipes");
  expect(ctl("layer-name").value).toBe("");
  ctl("layer-release").fire("click");
  expect(calls.release).toHaveBeenCalledTimes(1);
});

test("UI-836 the layer buttons give the reason in their title and aria-disabled: no selection, a draft, the original view", () => {
  store.set({ session: base([layer({})], 0) });
  expect(ctl("layer-new").getAttribute("aria-disabled")).toBe("true");
  expect(ctl("layer-new").title).toContain("Select some points first");
  store.set({ session: base([layer({})], 3), draft: true });
  expect(ctl("layer-release").title).toContain("Commit or discard the draft first");
  store.set({ draft: false, compare: "original" });
  expect(ctl("layer-new").title).toContain("Return to the edited view first");
  store.set({ compare: "edited" });
  expect(ctl("layer-new").getAttribute("aria-disabled")).toBe("false");
});

test("UI-837 every layer control is described and has a tooltip; the section note says edits are not in the timeline", () => {
  for (const id of ["layer-new", "layer-name", "layer-assign", "layer-release"]) {
    expect(describeControls().find((d) => d.id === id)?.label).toBeTruthy();
    expect(TOOLTIPS[id]).toBeTruthy();
  }
  expect(section().text()).toMatch(/not in the timeline/);
  expect(section().text()).toMatch(/re-assigning/);
});

test("UI-838 a layer-less session shows only Main-less empty state: no rows and a hint to select points first", () => {
  store.set({ session: sessionFixture() });
  expect(rows()).toHaveLength(0);
  expect(section().text()).toContain("No layers yet");
});
