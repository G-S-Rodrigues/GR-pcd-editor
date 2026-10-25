import { afterAll, expect, test } from "vitest";
import { colourOptionsFor } from "../colour/modes";
import { createAppStore } from "../state/app";
import { sessionFixture } from "../testing/fixtures";
import { type FakeEl, installFakeDom } from "../testing/fakedom";
import { buildDisplayPopover } from "./displaypop";

const dom = installFakeDom();
afterAll(() => dom.restore());
const store = createAppStore();
const themes: string[] = [];
buildDisplayPopover(dom.root as unknown as HTMLElement, store, { size: () => ({ w: 100, h: 100 }), refresh: () => undefined, theme: "dark", setTheme: (c) => void themes.push(c) });
const byId = (id: string) => dom.root.control(id) as FakeEl;

test("UI-1137 the Display popover holds Colour with its modes (five, and Layers as the sixth once the session has layers), Point size with Auto, Draw up to, and the Theme group that calls setTheme", () => {
  expect(dom.root.all().find((e) => e.tag === "h4")?.text()).toBe("Display");
  const modeIds = () => byId("colour-mode").children.filter((c) => c.tag === "option").map((o) => o.getAttribute("value"));
  store.set({ session: sessionFixture() });
  expect(modeIds()).toEqual(colourOptionsFor([], false).map((o) => o.id));
  expect(modeIds()).toHaveLength(5);
  store.set({ session: sessionFixture({ layers: [{ id: 1 } as never] }) });
  expect(modeIds()).toEqual(colourOptionsFor([], true).map((o) => o.id));
  expect(modeIds()).toHaveLength(6); // R22-10: all six modes, the sixth (Layers) once the session has layers
  expect(byId("point-size").getAttribute("type")).toBe("range");
  expect(byId("point-size-auto")).toBeDefined();
  expect(byId("budget").children.filter((c) => c.tag === "option")).toHaveLength(4);
  const group = dom.root.all().find((e) => e.getAttribute("role") === "group" && e.getAttribute("aria-label") === "Theme") as FakeEl;
  expect(group.all().filter((e) => e.attrs.has("data-control")).map((e) => e.getAttribute("data-control"))).toEqual(["theme-system", "theme-light", "theme-dark"]);
  expect(["system", "light", "dark"].map((c) => byId(`theme-${c}`).getAttribute("aria-pressed"))).toEqual(["false", "false", "true"]);
  byId("theme-light").fire("click");
  expect(themes).toEqual(["light"]);
  expect(["system", "light", "dark"].map((c) => byId(`theme-${c}`).getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
});
