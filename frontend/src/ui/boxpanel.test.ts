import { afterAll, expect, test } from "vitest";
import { FIELD_SPECS } from "./fields";
import { createAppStore } from "../state/app";
import { sessionFixture } from "../testing/fixtures";
import { type FakeEl, installFakeDom } from "../testing/fakedom";
import { fitToBounds } from "../tools/box/model";
import { type PanelActions, buildEditPanels } from "./panels";
import type { PopEntry } from "./popover";

const dom = installFakeDom();
afterAll(() => dom.restore());
const store = createAppStore();
store.set({ ...createAppStore().get(), session: sessionFixture(), tool: "box" });
const actions = new Proxy({} as Record<string, unknown>, { get: (t, k: string) => t[k] ?? (() => undefined) }) as unknown as PanelActions;
const entries: PopEntry[] = [];
let closed = 0;
const FakeCtor = dom.root.constructor as new (t: string) => FakeEl;
buildEditPanels(dom.root as unknown as HTMLElement, store, actions, {
  pops: { add: (e) => void entries.push(e), close: () => void closed++ },
  popRoot: new FakeCtor("div") as unknown as HTMLElement,
});
const ctl = (id: string) => dom.root.control(id) as FakeEl;
const cls = (e: FakeEl) => e.className.split(/\s+/);
const disc = (name: string) => dom.root.all().find((e) => e.tag === "details" && cls(e).includes("disc") && e.children[0].text().includes(name)) as FakeEl;
const rowOf = (...ids: string[]) => dom.root.all().find((e) => cls(e).includes("prow") && ids.every((i) => e_has(e, i))) as FakeEl | undefined;
const e_has = (e: FakeEl, id: string) => e.control(id) !== undefined;

test("UI-1168 the Box panel: segmented Inside/Outside, reset rotation beside the angles, Min / max and Handles as closed disclosures, a Fit menu, a visible Reset box", () => {
  const group = ctl("box-mode");
  expect(group.tag).toBe("div");
  expect(group.getAttribute("role")).toBe("radiogroup");
  expect(cls(group)).toContain("seg");
  const radios = group.children.filter((c) => c.getAttribute("role") === "radio");
  expect(radios.map((r) => r.text())).toEqual(["Inside", "Outside"]);
  radios[1].fire("click");
  expect(store.get().tools.box.mode).toBe("outside");
  expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true"]);
  expect(rowOf("box-roll", "box-pitch", "box-yaw", "box-reset-rotation")).toBeDefined();

  const mm = disc("Min / max");
  expect(mm.hasAttribute("open")).toBe(false);
  for (const id of ["box-min-x", "box-min-y", "box-min-z", "box-max-x", "box-max-y", "box-max-z"]) expect(mm.control(id)).toBeDefined();
  expect(mm.text()).toContain("World extents");
  const hd = disc("Handles");
  expect(hd.hasAttribute("open")).toBe(false);
  for (const id of ["gizmo-snap", "gizmo-step", "gizmo-angle-step"]) expect(hd.control(id)).toBeDefined();
  expect(cls(hd.control("gizmo-snap") as FakeEl)).toContain("switch");
  expect(hd.control("gizmo-snap")?.getAttribute("type")).toBe("checkbox");

  const fit = entries.find((e) => e.id === "box-fit");
  expect(fit).toBeDefined();
  expect((fit?.anchor as unknown as FakeEl).getAttribute("data-control")).toBe("box-fit");
  const menu = fit?.panel as unknown as FakeEl;
  for (const id of ["box-fit-cloud", "box-fit-displayed", "box-fit-view", "box-fit-selection"]) expect(menu.control(id)).toBeDefined();
  const reset = ctl("box-reset");
  expect(reset).toBeDefined();
  expect(mm.control("box-reset") ?? hd.control("box-reset") ?? menu.control("box-reset")).toBeUndefined();

  for (const spec of FIELD_SPECS.filter((s) => s.group === "box")) {
    const n = dom.root.all().filter((e) => e.getAttribute("data-control") === spec.id).length;
    expect(n, spec.id).toBe(1);
  }
});

test("UI-1169 a Fit menu item runs its fit and closes the menu", () => {
  store.update((s) => ({ ...s, tools: { ...s.tools, box: { ...s.tools.box, center: [9, 9, 9], dimensions: [1, 1, 1] } } }));
  const before = store.get().tools.box;
  closed = 0;
  ctl("box-fit-cloud").fire("click");
  expect(store.get().tools.box).toEqual(fitToBounds(before, store.get().session!.active_bounds!));
  expect(closed).toBe(1);
});

test("UI-1267 the Reset box tooltip names the 3 m default box, not a unit box", () => {
  const tip = FIELD_SPECS.find((s) => s.id === "box-reset")!.tooltip;
  expect(tip).toMatch(/3 m/);
  expect(tip).not.toMatch(/unit box/);
});
