import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { createAppStore } from "../state/app";
import { sessionFixture } from "../testing/fixtures";
import { type FakeEl, installFakeDom } from "../testing/fakedom";
import type { Layer } from "../state/types";
import { protectedTip } from "../layers/model";
import type { PanelActions } from "./panels";
import { buildLayersPanel } from "./layerspanel";
import { describeControls } from "./describe";
import { SECTION_IDS } from "./sections";
import { TOOLTIPS } from "./tooltips";

// the control registry rejects a second build of the same ids: build once, reset the state per test
const dom = installFakeDom();
afterAll(() => dom.restore());
const store = createAppStore();
const calls = { create: vi.fn(), assign: vi.fn(), release: vi.fn(), select: vi.fn(), toggle: vi.fn(), toMain: vi.fn(), choose: vi.fn(), edit: vi.fn(), set: vi.fn(), fromBand: vi.fn(), rename: vi.fn(), colour: vi.fn(), flag: vi.fn(), op: vi.fn(), move: vi.fn(), merge: vi.fn(), delPoints: vi.fn() };
const actions = new Proxy(
  { layerCreate: calls.create, layerAssign: calls.assign, layerRelease: calls.release, layerSelect: calls.select, layerToggle: calls.toggle, layerToMain: calls.toMain, layerChoose: calls.choose, layerEdit: calls.edit, layerSet: calls.set, layerFromBand: calls.fromBand, layerRename: calls.rename, layerColour: calls.colour, layerFlag: calls.flag, layerOp: calls.op, layerMove: calls.move, layerMerge: calls.merge, layerDeletePoints: calls.delPoints } as Record<string, unknown>,
  { get: (t, k: string) => t[k] ?? (() => undefined) },
) as unknown as PanelActions;
buildLayersPanel(dom.root as unknown as HTMLElement, store, actions);
const ctl = (id: string) => dom.root.control(id) as FakeEl;
const byId = (id: string) => dom.root.all().find((e) => e.getAttribute("id") === id) as FakeEl;
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
  expect(SECTION_IDS[SECTION_IDS.length - 1]).toBe("layers"); // Layers is the last fold
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

test("UI-837 every layer control is described and has a tooltip; the section note says edits are timeline steps", () => {
  for (const id of ["layer-new", "layer-name", "layer-assign", "layer-release", "layer-set"]) {
    expect(describeControls().find((d) => d.id === id)?.label).toBeTruthy();
    expect(TOOLTIPS[id]).toBeTruthy();
  }
  expect(section().text()).toMatch(/timeline steps/);
  const note = section().all().find((e) => e.getAttribute("title")?.includes("Undo reverts them")); // 17: the long advice is the note's tooltip
  expect(note?.text()).toBe("Layer edits are timeline steps; Undo reverts them.");
  expect(note?.getAttribute("title")).not.toContain("re-assigning");
  expect(TOOLTIPS["layer-new"]).toContain("it is a timeline step"); // UI-944
});

test("UI-838 a layer-less session shows only Main-less empty state: no rows and a hint to select points first", () => {
  store.set({ session: sessionFixture() });
  expect(rows()).toHaveLength(0);
  expect(section().text()).toContain("No layers yet");
});

test("UI-863 each row has an Edit button: inactive for a hidden layer (Show the layer first) and a click on a working one asks to edit that layer", () => {
  store.set({ session: base([layer({ bounds: { min: [0, 0, 0], max: [1, 1, 1] } }), layer({ id: 2, name: "Wall", colour: 1, visible: false, count: 20 })]) });
  expect(rowBtn(1, "edit").getAttribute("aria-disabled")).toBe("false");
  expect(rowBtn(2, "edit").getAttribute("aria-disabled")).toBe("true");
  expect(rowBtn(2, "edit").title).toContain("Show the layer first");
  rowBtn(1, "edit").fire("click");
  expect(calls.edit).toHaveBeenCalledWith(1);
});

test("UI-864 while a layer is being edited the panel says how many members it has and how many the box selects, and Set layer to selection appears", () => {
  const set = () => ctl("layer-set");
  expect(set().hidden).toBe(true);
  expect(byId("layer-editing").hidden).toBe(true);
  store.set({ session: base([layer({}), layer({ id: 2, name: "Wall", visible: false, count: 20 })], 12), layerUi: { editing: 1, active: 1 } });
  expect(set().hidden).toBe(false);
  expect(byId("layer-editing").hidden).toBe(false);
  expect(byId("layer-editing").text()).toBe("Editing layer Floor: 30 members, the box selects 12");
  set().fire("click");
  expect(calls.set).toHaveBeenCalledTimes(1);
  store.set({ session: base([layer({}), layer({ id: 2, name: "Wall", visible: false, count: 20 })], 0) });
  expect(set().getAttribute("aria-disabled")).toBe("true");
  expect(set().title).toContain("Select some points first");
  store.set({ layerUi: { editing: null, active: 1 } });
  expect(set().hidden).toBe(true);
});

test("UI-892 a layer row is one line (chip, name, count, eye, Select, chevron) with its details area hidden; the chevron toggles it with aria-expanded and the row keeps its click", () => {
  const floor = rows().find((r) => r.getAttribute("data-layer-row") === "1") as FakeEl;
  expect(floor.children).toHaveLength(6);
  expect(floor.children.slice(3).map((c) => c.tag)).toEqual(["button", "button", "button"]);
  expect([3, 4, 5].map((i) => ["data-layer-eye", "data-layer-select", "data-layer-more"].map((k) => floor.children[i].getAttribute(k)).findIndex((v) => v === "1"))).toEqual([0, 1, 2]);
  expect(floor.text()).toBe("Floor (30)");
  const details = () => section().all().find((e) => e.getAttribute("data-layer-details") === "1") as FakeEl;
  expect(details().getAttribute("hidden")).not.toBeNull();
  expect(rowBtn(1, "more").getAttribute("aria-expanded")).toBe("false");
  expect(rowBtn(1, "edit").text()).toBe("Edit layer");
  expect(rowBtn(1, "tomain").text()).toBe("To main");
  rowBtn(1, "more").fire("click");
  expect(details().getAttribute("hidden")).toBeNull();
  expect(rowBtn(1, "more").getAttribute("aria-expanded")).toBe("true");
  expect(calls.choose).not.toHaveBeenCalled(); // the chevron does not choose the row
  store.set({ layerUi: { editing: null, active: 2 } }); // a rebuild keeps the row open
  expect(details().getAttribute("hidden")).toBeNull();
  rowBtn(1, "more").fire("click");
  expect(details().getAttribute("hidden")).not.toBeNull();
  expect(rowBtn(1, "more").getAttribute("aria-expanded")).toBe("false");
});

const attrBtn = (attr: string, id: number) => section().all().find((e) => e.getAttribute(attr) === String(id)) as FakeEl;
const opBtn = (id: number, op: string) => section().all().find((e) => e.getAttribute("data-layer-op") === op && e.getAttribute("data-layer-of") === String(id)) as FakeEl;
const details = (id: number) => section().all().find((e) => e.getAttribute("data-layer-details") === String(id)) as FakeEl;
const twoLayers = (over1: Partial<Layer> = {}, over2: Partial<Layer> = {}) => base([layer({ bounds: { min: [0, 0, 0], max: [1, 1, 1] }, ...over1 }), layer({ id: 2, name: "Wall", colour: 1, count: 20, ...over2 })]);

test("UI-921 Floor's details are hidden by default and hold the 7 groups in order; each control fires its action with id 1", () => {
  store.set({ session: twoLayers() });
  expect(details(1).getAttribute("hidden")).not.toBeNull();
  expect(details(1).children.map((g) => g.className.split(" ")[1])).toEqual(["g-rename", "g-colour", "g-flags", "g-ops", "g-member", "g-order", "g-delete"]);
  const input = attrBtn("data-layer-rename", 1);
  input.value = "Ground";
  attrBtn("data-layer-rename-ok", 1).fire("click");
  input.value = "Kerb";
  input.fire("keydown", { key: "Enter" });
  expect(calls.rename.mock.calls).toEqual([[1, "Ground"], [1, "Kerb"]]);
  expect(section().all().filter((e) => e.getAttribute("data-layer-colour") === "1")).toHaveLength(16);
  section().all().find((e) => e.getAttribute("data-layer-colour") === "1" && e.getAttribute("data-colour") === "3")?.fire("click");
  expect(calls.colour).toHaveBeenCalledWith(1, 3);
  expect(section().all().find((e) => e.getAttribute("data-layer-colour") === "1" && e.getAttribute("data-colour") === "0")?.getAttribute("aria-pressed")).toBe("true");
  attrBtn("data-layer-protected", 1).fire("click");
  attrBtn("data-layer-lock", 1).fire("click");
  expect(calls.flag.mock.calls).toEqual([[1, "protected", true], [1, "locked", true]]);
  attrBtn("data-layer-visible", 1).fire("click");
  expect(calls.toggle).toHaveBeenCalledWith(1);
  for (const op of ["select", "add", "subtract", "intersect"]) opBtn(1, op).fire("click");
  expect(calls.op.mock.calls).toEqual([[1, "replace"], [1, "add"], [1, "subtract"], [1, "intersect"]]);
  attrBtn("data-layer-edit", 1).fire("click");
  attrBtn("data-layer-tomain", 1).fire("click");
  attrBtn("data-layer-down", 1).fire("click");
  expect(calls.edit).toHaveBeenCalledWith(1);
  expect(calls.toMain).toHaveBeenCalledWith(1);
  expect(calls.move).toHaveBeenCalledWith(1, 1);
  attrBtn("data-layer-merge", 1).fire("click");
  expect(calls.merge).toHaveBeenCalledWith(1, 2);
  attrBtn("data-layer-delete-points", 1).fire("click");
  expect(calls.delPoints).toHaveBeenCalledWith(1);
  attrBtn("data-layer-up", 2).fire("click");
  expect(calls.move).toHaveBeenCalledWith(2, -1);
});

test("UI-922 a protected layer's chip has no ring class (R22-3: the shield is the mark), a locked one has class locked; the row title names them and the row keeps its shape plus the shield", () => {
  store.set({ session: twoLayers({ protected: true }, { locked: true }) });
  const chipOfRow = (id: number) => rows().find((r) => r.getAttribute("data-layer-row") === String(id))?.children[0] as FakeEl;
  expect(chipOfRow(1).classList.contains("protected")).toBe(false);
  expect(chipOfRow(1).classList.contains("locked")).toBe(false);
  expect(chipOfRow(2).classList.contains("locked")).toBe(true);
  const floor = rows().find((r) => r.getAttribute("data-layer-row") === "1") as FakeEl;
  expect(floor.title).toContain("Protected");
  expect(rows().find((r) => r.getAttribute("data-layer-row") === "2")?.title).toContain("Locked");
  expect(floor.children).toHaveLength(7);
  expect(floor.text()).toContain("Floor (30)");
});

test("UI-1013 a protected layer's row holds the shield after the name and before the count; unprotected rows hold none; the store flag adds and removes it", () => {
  store.set({ session: twoLayers({ protected: true }) });
  const row = (id: number) => rows().find((r) => r.getAttribute("data-layer-row") === String(id)) as FakeEl;
  const shield = row(1).children[2];
  expect(shield.getAttribute("data-layer-shield")).toBe("1");
  expect(shield.getAttribute("role")).toBe("img");
  expect(shield.getAttribute("aria-label")).toBe("Protected");
  expect(shield.title).toBe(protectedTip("Floor"));
  expect(shield.all().some((e) => e.tag === "svg")).toBe(true);
  expect(row(1).children[1].className).toContain("layer-name");
  expect(row(1).children[3].className).toContain("layer-count");
  expect(row(2).all().some((e) => e.getAttribute("data-layer-shield") !== null)).toBe(false);
  store.set({ session: twoLayers({ protected: false }) });
  expect(row(1).all().some((e) => e.getAttribute("data-layer-shield") !== null)).toBe(false);
  store.set({ session: twoLayers({ protected: true }) });
  expect(row(1).all().some((e) => e.getAttribute("data-layer-shield") === "1")).toBe(true);
});

test("UI-1014 the menu's Protected flag holds the shield svg first, keeps its text and aria-pressed", () => {
  store.set({ session: twoLayers({ protected: true }) });
  const flag = attrBtn("data-layer-protected", 1);
  expect(flag.children[0].tag).toBe("svg");
  expect(flag.text()).toBe("Protected");
  expect(flag.getAttribute("aria-pressed")).toBe("true");
  store.set({ session: twoLayers({ protected: false }) });
  expect(attrBtn("data-layer-protected", 1).getAttribute("aria-pressed")).toBe("false");
});

test("UI-923 while a layer is edited its details are open and hold #layer-set exactly once, through rebuilds; afterwards it is back in the stack", () => {
  store.set({ session: twoLayers(), layerUi: { editing: 1, active: 1 } });
  const setIn = (el: FakeEl) => el.all().filter((e) => e.getAttribute("id") === "layer-set" || e.getAttribute("data-control") === "layer-set");
  expect(details(1).getAttribute("hidden")).toBeNull();
  expect(setIn(details(1))).toHaveLength(1);
  expect(setIn(section())).toHaveLength(1);
  store.set({ session: twoLayers({ count: 31 }) });
  expect(setIn(details(1))).toHaveLength(1);
  expect(setIn(section())).toHaveLength(1);
  store.set({ layerUi: { editing: null, active: 1 } });
  expect(setIn(details(1))).toHaveLength(0);
  expect(setIn(section())).toHaveLength(1);
  expect(ctl("layer-set").hidden).toBe(true);
});

test("UI-924 layer-from-band is described, has a tooltip and a field entry; its state follows layerButtons.fromBand", () => {
  expect(describeControls().find((d) => d.id === "layer-from-band")?.label).toBeTruthy();
  expect(TOOLTIPS["layer-from-band"]).toBeTruthy();
  store.set({ session: twoLayers() });
  expect(ctl("layer-from-band").getAttribute("aria-disabled")).toBe("true");
  expect(ctl("layer-from-band").title).toContain("Turn on height protection first");
  const s = twoLayers();
  store.set({ session: { ...s, protection: { ...s.protection, global: { ...s.protection.global, enabled: true } } } });
  expect(ctl("layer-from-band").getAttribute("aria-disabled")).toBe("false");
  ctl("layer-from-band").fire("click");
  expect(calls.fromBand).toHaveBeenCalledTimes(1);
});

test("UI-925 the merge target lists the other layers but not the layer itself; with one layer Merge is inactive with the reason", () => {
  store.set({ session: twoLayers() });
  const sel = attrBtn("data-layer-merge-target", 1);
  expect(sel.children.map((o) => o.text())).toEqual(["Wall"]);
  store.set({ session: base([layer({})]) });
  expect(attrBtn("data-layer-merge", 1).getAttribute("aria-disabled")).toBe("true");
  expect(attrBtn("data-layer-merge", 1).title).toContain("No other layer to merge into");
});

test("UI-926 a locked layer's Edit, To main and Merge are inactive with the reason; a protected layer's Delete points; Up on the first row and Down on the last", () => {
  store.set({ session: twoLayers({ locked: true, protected: true }) });
  for (const k of ["edit", "tomain", "merge"]) {
    expect(attrBtn(`data-layer-${k}`, 1).getAttribute("aria-disabled")).toBe("true");
    expect(attrBtn(`data-layer-${k}`, 1).title).toContain("The layer is locked");
  }
  expect(attrBtn("data-layer-delete-points", 1).getAttribute("aria-disabled")).toBe("true");
  expect(attrBtn("data-layer-delete-points", 1).title).toContain("The layer is protected");
  expect(attrBtn("data-layer-up", 1).getAttribute("aria-disabled")).toBe("true");
  expect(attrBtn("data-layer-down", 1).getAttribute("aria-disabled")).toBe("false");
  expect(attrBtn("data-layer-up", 2).getAttribute("aria-disabled")).toBe("false");
  expect(attrBtn("data-layer-down", 2).getAttribute("aria-disabled")).toBe("true");
  attrBtn("data-layer-edit", 1).fire("click");
  expect(calls.edit).not.toHaveBeenCalled();
});

test("UI-984 a different session forgets the open fold-outs: layer 1 of the next file starts closed", () => {
  rowBtn(1, "more").fire("click");
  expect(rowBtn(1, "more").getAttribute("aria-expanded")).toBe("true");
  store.set({ session: { ...(store.get().session as NonNullable<ReturnType<typeof sessionFixture>>), session_id: "s2" } });
  expect(rowBtn(1, "more").getAttribute("aria-expanded")).toBe("false");
});
