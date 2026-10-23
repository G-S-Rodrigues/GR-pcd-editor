import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { createAppStore } from "../state/app";
import { sessionFixture } from "../testing/fixtures";
import { type FakeEl, installFakeDom } from "../testing/fakedom";
import { type DetectedPlane } from "../tools/plane/model";
import { type PanelActions, buildEditPanels, buildToolPalette } from "./panels";
import { TOOLTIPS } from "./tooltips";
import { SECTION_IDS } from "./sections";

const dom = installFakeDom();
afterAll(() => dom.restore());
const store = createAppStore();
const calls: Record<string, ReturnType<typeof vi.fn>> = {};
const actions = new Proxy({} as Record<string, unknown>, {
  get: (t, k: string) => t[k] ?? (calls[k] ??= vi.fn(() => undefined)),
}) as unknown as PanelActions;
const toolRoot = new (dom.root.constructor as new (t: string) => FakeEl)("div");
const palette = new (dom.root.constructor as new (t: string) => FakeEl)("div");
buildToolPalette(palette as unknown as HTMLElement, store, actions);
buildEditPanels(dom.root as unknown as HTMLElement, store, actions, { toolRoot: toolRoot as unknown as HTMLElement, scroller: { scrollTop: 5 } });
const ctl = (id: string) => palette.control(id) ?? (toolRoot.all().find((e) => e.getAttribute("id") === id || e.getAttribute("data-control") === id) as FakeEl);
const section = (id: string) => toolRoot.children.find((c) => c.getAttribute("data-section") === id) as FakeEl;
const det = (z: number, count: number): DetectedPlane => ({ normal: [0, 0, 1], d: z, count, rms: 0.01, tilt_deg: 0, z_centre: z, bounds: { min: [0, 0, z], max: [1, 1, z] } });

beforeEach(() => {
  for (const c of Object.values(calls)) c.mockClear();
  store.set({ ...createAppStore().get(), session: sessionFixture() });
});

test("UI-969 the Planes and Thin buttons exist with labels and tooltips; arming one makes its section visible and opens a folded one", () => {
  for (const [id, label] of [["tool-plane", "Planes"], ["tool-thin", "Thin"]] as const) {
    const b = ctl(id);
    expect(b.text()).toBe(label);
    expect(b.title).toBe(TOOLTIPS[id]);
    expect(b.disabled).toBe(false);
  }
  expect(section("plane").hidden).toBe(true);
  store.update((s) => ({ ...s, sectionsOpen: { plane: false } }));
  ctl("tool-plane").fire("click");
  expect(calls.setTool).toHaveBeenCalledWith("plane");
  store.set({ tool: "plane" });
  expect(section("plane").hidden).toBe(false);
  expect(store.get().sectionsOpen.plane).toBeUndefined();
  expect(section("thin").hidden).toBe(true);
  store.set({ tool: "thin" });
  expect(section("thin").hidden).toBe(false);
  expect(ctl("tool-thin").classList.contains("active")).toBe(true);
  expect(SECTION_IDS.slice(SECTION_IDS.indexOf("sparse"), SECTION_IDS.indexOf("sparse") + 3)).toEqual(["sparse", "plane", "thin"]);
});

test("UI-973 the list renders the rows from planeRows; Select and Use as protection band call the actions with the row", () => {
  store.update((s) => ({ ...s, tool: "plane", planes: { ...s.planes, list: [det(0, 1600), det(3, 900)], revision: 3, eligible: 2500, scope: "displayed" } }));
  const list = ctl("plane-list");
  const rows = list.all().filter((e) => e.getAttribute("data-plane") !== null);
  expect(rows).toHaveLength(2);
  expect(rows[0].text()).toContain("Lowest (floor?)");
  expect(rows[1].text()).toContain("Highest (ceiling?)");
  expect(rows[1].text()).toContain("z 3, tilt 0 deg, 900 points");
  list.all().find((e) => e.getAttribute("id") === "plane-select-1")!.fire("click");
  expect(calls.planeSelect).toHaveBeenCalledWith(1);
  list.all().find((e) => e.getAttribute("id") === "plane-band-0")!.fire("click");
  expect(calls.planeBand).toHaveBeenCalledWith(0);
  store.update((s) => ({ ...s, planes: { ...s.planes, chosenRow: 1 } }));
  expect(ctl("plane-list").all().find((e) => e.getAttribute("data-plane") === "1")!.classList.contains("chosen")).toBe(true);
  // a refusal shows under its row
  store.update((s) => ({ ...s, planes: { ...s.planes, rowNote: { row: 0, text: "This plane needs a tilt of rx 0, ry 65 degrees; the protection band allows at most 60 on each" } } }));
  expect(ctl("plane-list").all().find((e) => e.getAttribute("id") === "plane-note-0")!.text()).toMatch(/at most 60 on each/);
  // a list from an older cloud revision is not shown
  store.update((s) => ({ ...s, session: sessionFixture({ revision: { cloud: 8, params: 4 } }) }));
  expect(ctl("plane-list").all().filter((e) => e.getAttribute("data-plane") !== null)).toHaveLength(0);
});

test("UI-971 Detect is off while a detection runs and Cancel shows only then", () => {
  store.set({ tool: "plane" });
  const detect = ctl("plane-detect");
  const cancel = ctl("plane-cancel");
  expect(detect.disabled).toBe(false);
  expect(cancel.hidden).toBe(true);
  detect.fire("click");
  expect(calls.planeDetect).toHaveBeenCalledTimes(1);
  store.update((s) => ({ ...s, planes: { ...s.planes, busy: true } }));
  expect(detect.disabled).toBe(true);
  expect(cancel.hidden).toBe(false);
  cancel.fire("click");
  expect(calls.planeCancel).toHaveBeenCalledTimes(1);
});

test("UI-975 Thin: the Method select shows the field of the chosen method only; a field edit re-previews", () => {
  store.set({ tool: "thin" });
  const wrap = (id: string) => toolRoot.all().find((e) => e.tag === "label" && e.children.some((c) => c.getAttribute("id") === id)) as FakeEl;
  expect(wrap("thin-distance").hidden).toBe(false);
  expect(wrap("thin-edge").hidden).toBe(true);
  const method = ctl("thin-method");
  method.value = "voxel";
  method.fire("change");
  expect(store.get().tools.thin.method).toBe("voxel");
  expect(calls.toolChanged).toHaveBeenCalledTimes(1);
  expect(wrap("thin-distance").hidden).toBe(true);
  expect(wrap("thin-edge").hidden).toBe(false);
  const edge = ctl("thin-edge");
  edge.value = "0.2";
  edge.fire("change");
  expect(store.get().tools.thin.edge).toBe(0.2);
  expect(calls.toolChanged).toHaveBeenCalledTimes(2);
  edge.value = "0";
  edge.fire("change");
  expect(store.get().tools.thin.edge).toBe(0.2);
  expect(calls.toolChanged).toHaveBeenCalledTimes(2);
});

test("UI-983 the left panel head holds the two new tool buttons and every Planes and Thin control has a tooltip", () => {
  for (const id of ["tool-plane", "tool-thin"]) expect(palette.control(id), id).toBeDefined();
  for (const id of ["plane-distance", "plane-max-tilt", "plane-max", "plane-region", "plane-exclude-protected", "plane-detect", "plane-cancel", "plane-list", "thin-method", "thin-distance", "thin-edge", "thin-region", "thin-exclude-protected"]) {
    expect(TOOLTIPS[id]?.trim(), id).toBeTruthy();
  }
});

test("UI-1152 the plane fields open at the R22-15 defaults 0.1 / 5 / 1", () => {
  store.set({ tool: "plane" });
  expect(ctl("plane-distance").value).toBe("0.1");
  expect(ctl("plane-max-tilt").value).toBe("5");
  expect(ctl("plane-max").value).toBe("1");
});

test("UI-975a plane parameter edits validate and save without selecting; region and protection re-select only with a chosen plane", () => {
  store.set({ tool: "plane" });
  const dist = ctl("plane-distance");
  dist.value = "0.2";
  dist.fire("change");
  expect(store.get().tools.plane.distance).toBe(0.2);
  dist.value = "-1";
  dist.fire("change");
  expect(store.get().tools.plane.distance).toBe(0.2);
  expect(calls.toolChanged).not.toHaveBeenCalled();
  const ex = ctl("plane-exclude-protected");
  ex.checked = false;
  ex.fire("change");
  expect(calls.toolChanged).not.toHaveBeenCalled();
  store.update((s) => ({ ...s, planes: { ...s.planes, chosen: { normal: [0, 0, 1], d: 1, thickness: 0.1 } } }));
  ex.checked = true;
  ex.fire("change");
  expect(calls.toolChanged).toHaveBeenCalledTimes(1);
});
