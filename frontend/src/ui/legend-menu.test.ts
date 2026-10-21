import { afterAll, beforeAll, expect, test } from "vitest";
import { createAppStore } from "../state/app";
import { restoreClientState, serialiseClientState, applyClientPatch } from "../state/persist";
import { FakeEl, installFakeDom } from "../testing/fakedom";
import { LEGEND } from "../filterboxes/placement";
import { LEGEND_BOX } from "../view/layout";
import { describeControls } from "./describe";
import { PALETTE } from "../colour/palette";
import { RAMP_STOPS, cssGradient } from "../colour/ramps";
import { buildLegend, cssColour, legendEntries } from "./legend";
import { TOOLTIPS } from "./tooltips";

let dom: ReturnType<typeof installFakeDom>;
let root: FakeEl;
let modebar: FakeEl;
let api: ReturnType<typeof buildLegend>;
const store = createAppStore();
const header = () => root.control("legend-menu") as FakeEl;
const rows = () => root.all().filter((e) => e.getAttribute("data-legend")).map((e) => e.getAttribute("data-legend"));

beforeAll(() => {
  dom = installFakeDom();
  root = dom.root;
  modebar = new FakeEl("div");
  api = buildLegend(root as unknown as HTMLElement, store, modebar as unknown as HTMLElement);
});
afterAll(() => dom.restore());

test("UI-340 the menu is open by default, the header toggles it and aria-expanded mirrors the state", () => {
  expect(store.get().legendOpen).toBe(true);
  expect(header().tag).toBe("button");
  expect(header().getAttribute("aria-expanded")).toBe("true");
  const body = root.all().find((e) => e.getAttribute("data-legend-body") === "1") as FakeEl;
  expect(body.hasAttribute("hidden") || (body as unknown as { hidden: boolean }).hidden).toBe(false);
  header().fire("click");
  expect(store.get().legendOpen).toBe(false);
  expect(header().getAttribute("aria-expanded")).toBe("false");
  expect((body as unknown as { hidden: boolean }).hidden).toBe(true);
  header().fire("click");
  expect(store.get().legendOpen).toBe(true);
  expect(header().getAttribute("aria-expanded")).toBe("true");
});

test("UI-341 client state: a folded menu serialises ui.legendOpen false, an open one adds nothing, garbage is ignored", () => {
  const s = createAppStore();
  const open = serialiseClientState(s.get()) as { ui: Record<string, unknown> };
  expect("legendOpen" in open.ui).toBe(false);
  s.update((x) => ({ ...x, legendOpen: false }));
  const folded = JSON.parse(JSON.stringify(serialiseClientState(s.get()))) as { ui: Record<string, unknown> };
  expect(folded.ui.legendOpen).toBe(false);
  expect(JSON.stringify(folded)).not.toMatch(/filters|protection/);
  const patch = restoreClientState(folded);
  expect(patch?.legendOpen).toBe(false);
  expect(applyClientPatch(createAppStore().get(), patch ?? {}).legendOpen).toBe(false);
  for (const junk of [true, 0, "no", null, {}]) {
    expect(restoreClientState({ v: 1, ui: { legendOpen: junk } })?.legendOpen, String(junk)).toBeUndefined();
  }
  expect(applyClientPatch(createAppStore().get(), {}).legendOpen).toBe(true);
});

test("UI-342 the rows are the unchanged entries; Step highlight and the live-preview rows appear only in their states", () => {
  expect(rows()).toEqual(legendEntries().map((e) => e.id));
  api.update(true);
  expect(rows()).toEqual(legendEntries(true).map((e) => e.id));
  expect(rows()).toContain("step");
  api.update(false, "add");
  expect(rows()).toEqual(legendEntries(false, "add").map((e) => e.id));
  expect(rows()).toContain("preview-add");
  expect(rows()).not.toContain("step");
  api.update(false, "subtract");
  expect(rows()).toContain("preview-remove");
  api.update(false, null);
  expect(rows()).toEqual(legendEntries().map((e) => e.id));
});

test("UI-343 the header is a real button with a name and a tooltip (Enter and Space click a button natively; E2E-75 presses them)", () => {
  const d = describeControls().find((x) => x.id === "legend-menu");
  expect(d?.label).toBeTruthy();
  expect(header().getAttribute("aria-label")).toBe(d?.label);
  expect(header().getAttribute("type")).toBe("button");
  expect(header().title).toBe(TOOLTIPS["legend-menu"]);
  expect(header().getAttribute("aria-controls")).toBeTruthy();
});

test("UI-344 the reserved LEGEND rectangle is the expanded size the builder sets, so folding never moves the boxes", () => {
  expect(root.style.width).toBe(`${LEGEND_BOX.w}px`);
  expect(root.style.maxHeight).toBe(`${LEGEND_BOX.maxH}px`);
  expect(LEGEND).toEqual({ w: LEGEND_BOX.left + LEGEND_BOX.w + LEGEND_BOX.pad, h: LEGEND_BOX.top + LEGEND_BOX.maxH + LEGEND_BOX.pad });
});

test("UI-345 the mode line (id modebar) lives in the menu body, after the rows", () => {
  const body = root.all().find((e) => e.getAttribute("data-legend-body") === "1") as FakeEl;
  expect(body.children[body.children.length - 1]).toBe(modebar);
});

const ramp = () => root.all().find((e) => e.getAttribute("id") === "legend-ramp") as FakeEl;
const baseChip = () => root.all().find((e) => e.getAttribute("data-legend") === "base") as FakeEl;

test("UI-368 the colour key follows the active mode: a gradient with its end labels, replaced by nothing in Grey", () => {
  store.update((s) => ({ ...s, colour: { ...s.colour, mode: "turbo" } }));
  expect(ramp().hasAttribute("hidden")).toBe(false);
  expect(ramp().getAttribute("data-ramp")).toBe("turbo");
  expect(ramp().text()).toContain("Height (Turbo)");
  expect(ramp().text()).toContain("low");
  expect(ramp().text()).toContain("high");
  const bar = ramp().all().find((e) => e.getAttribute("data-ramp-bar") === "1") as FakeEl;
  expect(bar.style.background).toBe(cssGradient(RAMP_STOPS.turbo));
  expect(ramp().getAttribute("aria-label")).toMatch(/Height \(Turbo\)/);
  store.update((s) => ({ ...s, colour: { ...s.colour, mode: "viridis" } }));
  expect(ramp().getAttribute("data-ramp")).toBe("viridis");
  expect((ramp().all().find((e) => e.getAttribute("data-ramp-bar") === "1") as FakeEl).style.background).toBe(cssGradient(RAMP_STOPS.viridis));
  store.update((s) => ({ ...s, colour: { ...s.colour, mode: "flat" } }));
  expect(ramp().hasAttribute("hidden")).toBe(true);
});

test("UI-369 the Unselected chip shows the active ramp (a grey chip would lie in a coloured mode) and the base grey in Grey", () => {
  store.update((s) => ({ ...s, colour: { ...s.colour, mode: "viridis" } }));
  expect(baseChip().style.background).toBe(cssGradient(RAMP_STOPS.viridis));
  store.update((s) => ({ ...s, colour: { ...s.colour, mode: "flat" } }));
  expect(baseChip().style.background).toBe(cssColour(PALETTE.base));
  expect(rows()).toEqual(legendEntries().map((e) => e.id));
});
