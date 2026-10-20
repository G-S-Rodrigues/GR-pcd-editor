import { afterAll, beforeEach, expect, test } from "vitest";
import { createAppStore } from "../state/app";
import { sessionFixture } from "../testing/fixtures";
import { type FakeEl, installFakeDom } from "../testing/fakedom";
import { type PanelActions, buildToolPalette } from "./panels";
import { describeControls } from "./describe";
import { TOOLTIPS } from "./tooltips";

// the control registry rejects a second build of the same ids: build once, reset the state per test
const dom = installFakeDom();
afterAll(() => dom.restore());
const store = createAppStore();
const actions = new Proxy({} as Record<string, unknown>, { get: (t, k: string) => t[k] ?? (() => undefined) }) as unknown as PanelActions;
buildToolPalette(dom.root as unknown as HTMLElement, store, actions);
const ctl = (id: string) => dom.root.control(id) as FakeEl;
const IDS = ["sel-colour-orange", "sel-colour-magenta", "sel-colour-white", "sel-colour-lime"];
beforeEach(() => store.set({ ...createAppStore().get(), session: sessionFixture() }));

test("UI-726 four swatch radios in a radiogroup after Scope; one checked; roving tabindex; click, arrows and Space select; distinct titles", () => {
  const group = ctl("sel-colour");
  expect(group.getAttribute("role")).toBe("radiogroup");
  expect(group.children.map((c) => c.getAttribute("data-control"))).toEqual(IDS);
  const all = dom.root.all().map((e) => e.getAttribute("data-control"));
  expect(all.indexOf("sel-colour")).toBeGreaterThan(all.indexOf("scope-select"));
  const checked = () => IDS.map((id) => ctl(id).getAttribute("aria-checked"));
  expect(checked()).toEqual(["true", "false", "false", "false"]);
  expect(IDS.map((id) => ctl(id).tabIndex)).toEqual([0, -1, -1, -1]);
  ctl("sel-colour-white").fire("click");
  expect(store.get().selectedColour).toBe("white");
  expect(checked()).toEqual(["false", "false", "true", "false"]);
  expect(IDS.map((id) => ctl(id).tabIndex)).toEqual([-1, -1, 0, -1]);
  ctl("sel-colour-white").fire("keydown", { key: "ArrowRight", preventDefault() {} });
  expect(store.get().selectedColour).toBe("lime");
  ctl("sel-colour-lime").fire("keydown", { key: "ArrowRight", preventDefault() {} });
  expect(store.get().selectedColour).toBe("orange");
  ctl("sel-colour-orange").fire("keydown", { key: "ArrowLeft", preventDefault() {} });
  expect(store.get().selectedColour).toBe("lime");
  ctl("sel-colour-magenta").fire("keydown", { key: " ", preventDefault() {} });
  expect(store.get().selectedColour).toBe("magenta");
  expect(new Set(IDS.map((id) => ctl(id).title)).size).toBe(4);
  const ds = describeControls().map((d) => d.id);
  for (const id of ["sel-colour", ...IDS]) {
    expect(ds, id).toContain(id);
    expect(TOOLTIPS[id]?.length, id).toBeGreaterThan(10);
  }
});

test("UI-726 the swatches are disabled with no file open", () => {
  store.set({ session: null });
  for (const id of IDS) expect(ctl(id).disabled, id).toBe(true);
  store.set({ session: sessionFixture() });
  for (const id of IDS) expect(ctl(id).disabled, id).toBe(false);
});
