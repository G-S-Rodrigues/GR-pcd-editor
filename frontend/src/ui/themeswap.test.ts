import { afterAll, expect, test } from "vitest";
import { LIGHT_PALETTE, PALETTE, contrastRatio } from "../colour/palette";
import { LIGHT_AXIS_COLOUR } from "../filterboxes/plane";
import { LIGHT_FLOORS } from "../testing/floors";
import { SELECTED_COLOURS, selectedPresets } from "../colour/selectcolour";
import { LIGHT_MAIN_COLOUR, MAIN_COLOUR } from "../layers/model";
import { createAppStore } from "../state/app";
import type { Layer } from "../state/types";
import { type FakeEl, installFakeDom } from "../testing/fakedom";
import { sessionFixture } from "../testing/fixtures";
import { buildLayersPanel } from "./layerspanel";
import { buildLegend, cssColour } from "./legend";
import { type PanelActions, buildToolPalette } from "./panels";
import { AXIS_COLOUR as TRIAD_DARK, LIGHT_TRIAD_LETTER, buildTriad } from "./triad";

// the control registry rejects a second build of the same ids: build once on one store, switch the theme per step
const dom = installFakeDom();
afterAll(() => dom.restore());
const store = createAppStore();
const actions = new Proxy({} as Record<string, unknown>, { get: (t, k: string) => t[k] ?? (() => undefined) }) as unknown as PanelActions;
const legendRoot = new (dom.root.constructor as new (t: string) => FakeEl)("div");
const panelRoot = new (dom.root.constructor as new (t: string) => FakeEl)("div");
const layersRoot = new (dom.root.constructor as new (t: string) => FakeEl)("div");
buildLegend(legendRoot as unknown as HTMLElement, store);
buildToolPalette(panelRoot as unknown as HTMLElement, store, actions);
buildLayersPanel(layersRoot as unknown as HTMLElement, store, actions);
const layer = (over: Partial<Layer>): Layer => ({ id: 1, name: "Floor", colour: 0, visible: true, count: 30, bounds: null, ...over });

test("UI-1109 the legend chips, the Selected colour dots (and the White slot's name) and the Main chip recolour when renderTheme changes, with no rebuild, and back", () => {
  store.set({ session: sessionFixture({ layers: [layer({})] }), colour: { ...store.get().colour, mode: "flat" } });
  const legendChip = (id: string) => legendRoot.all().find((e) => e.getAttribute("data-legend") === id) as FakeEl;
  const dot = (id: string) => panelRoot.control(`sel-colour-${id}`) as FakeEl;
  const mainChip = () => layersRoot.all().find((e) => e.getAttribute("data-layer-row") === "0")!.all().find((e) => e.className.includes("chip")) as FakeEl;
  const dotsBefore = SELECTED_COLOURS.map((p) => dot(p.id));
  const mainBefore = mainChip();
  // dark (the default)
  expect(legendChip("base").style.background).toBe(cssColour(PALETTE.base));
  expect(legendChip("selected").style.background).toBe(cssColour(PALETTE.selected));
  expect(SELECTED_COLOURS.map((p) => dot(p.id).style.background)).toEqual(SELECTED_COLOURS.map((p) => cssColour(p.colour)));
  expect(dot("white").getAttribute("aria-label")).toBe("Selected colour White");
  expect(mainChip().style.background).toBe(MAIN_COLOUR);

  store.set({ renderTheme: "light" });
  expect(legendChip("base").style.background).toBe(cssColour(LIGHT_PALETTE.base));
  expect(legendChip("selected").style.background).toBe(cssColour(LIGHT_PALETTE.selected));
  expect(legendChip("protected").style.background).toBe(cssColour(LIGHT_PALETTE.protected));
  expect(legendChip("slab").style.background).toBe(cssColour(LIGHT_PALETTE.slab));
  expect(legendChip("deleted").style.background).toBe(cssColour(LIGHT_PALETTE.deleted));
  const light = selectedPresets("light");
  expect(SELECTED_COLOURS.map((p) => dot(p.id).style.background)).toEqual(light.map((p) => cssColour(p.colour)));
  expect(dot("white").getAttribute("aria-label")).toBe("Selected colour Blue");
  expect(dot("magenta").getAttribute("aria-label")).toBe("Selected colour Magenta");
  expect(mainChip().style.background).toBe(LIGHT_MAIN_COLOUR);
  // no rebuild: the same elements, so focus and a click in flight are kept
  expect(SELECTED_COLOURS.map((p) => dot(p.id))).toEqual(dotsBefore);
  expect(mainChip()).toBe(mainBefore);
  // a chosen Selected colour follows the theme in the legend too
  store.set({ selectedColour: "white" });
  expect(legendChip("selected").style.background).toBe(cssColour(light[2].colour));

  store.set({ renderTheme: "dark" });
  expect(legendChip("selected").style.background).toBe(cssColour(SELECTED_COLOURS[2].colour));
  store.set({ selectedColour: "orange" });
  expect(legendChip("base").style.background).toBe(cssColour(PALETTE.base));
  expect(SELECTED_COLOURS.map((p) => dot(p.id).style.background)).toEqual(SELECTED_COLOURS.map((p) => cssColour(p.colour)));
  expect(dot("white").getAttribute("aria-label")).toBe("Selected colour White");
  expect(mainChip().style.background).toBe(MAIN_COLOUR);
});

test("UI-1111 the axis triad follows renderTheme: light lines are the light axis colours, light letters meet 4.5:1 on the light halo, dark is unchanged, and back", () => {
  const t = installFakeDom();
  const tstore = createAppStore();
  buildTriad(t.root as unknown as HTMLElement, tstore);
  const svg = t.root.children[0];
  const lines = () => svg.all().filter((e) => e.tag === "line").map((e) => e.getAttribute("stroke"));
  const texts = () => svg.all().filter((e) => e.tag === "text");
  const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
  const dark = [TRIAD_DARK.x, TRIAD_DARK.y, TRIAD_DARK.z];
  expect(lines()).toEqual(dark);
  expect(texts().map((e) => e.getAttribute("fill"))).toEqual(dark);
  expect(texts().map((e) => e.getAttribute("stroke"))).toEqual(["#15181d", "#15181d", "#15181d"]);

  tstore.set({ renderTheme: "light" });
  expect(lines()).toEqual([hex(LIGHT_AXIS_COLOUR.x), hex(LIGHT_AXIS_COLOUR.y), hex(LIGHT_AXIS_COLOUR.z)]);
  expect(lines()).toEqual(["#e0352b", "#1f9b3b", "#1f6fe0"]);
  expect(texts().map((e) => e.getAttribute("fill"))).toEqual([LIGHT_TRIAD_LETTER.x, LIGHT_TRIAD_LETTER.y, LIGHT_TRIAD_LETTER.z]);
  expect(texts().map((e) => e.getAttribute("stroke"))).toEqual(["#e9ebef", "#e9ebef", "#e9ebef"]);
  // letters are text: 4.5 against the halo (the test pins the floor and the map, not the chosen shade)
  for (const c of Object.values(LIGHT_TRIAD_LETTER)) expect(contrastRatio(c, "#e9ebef"), c).toBeGreaterThanOrEqual(LIGHT_FLOORS.triadLetters);

  tstore.set({ renderTheme: "dark" });
  expect(lines()).toEqual(dark);
  expect(texts().map((e) => e.getAttribute("fill"))).toEqual(dark);
  expect(texts().map((e) => e.getAttribute("stroke"))).toEqual(["#15181d", "#15181d", "#15181d"]);
  t.restore();
});
