import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { createAppStore } from "../state/app";
import { sessionFixture } from "../testing/fixtures";
import { type FakeEl, installFakeDom } from "../testing/fakedom";
import { describeControls } from "./describe";
import { buildPalette } from "./palette";
import { type PanelActions, buildToolPalette } from "./panels";
import { TOOLTIPS } from "./tooltips";

const dom = installFakeDom();
afterAll(() => dom.restore());
const store = createAppStore();
const setTool = vi.fn();
const mk = () => new (dom.root.constructor as new (t: string) => FakeEl)("div");
const palette = mk();
const pill = mk();
const IDS = ["tool-box", "tool-polygon", "tool-cluster", "tool-sparse", "tool-plane", "tool-thin"];
const NAMES = ["Box", "Polygon", "Cluster", "Sparse points", "Planes", "Thin"];
const tools = ["box", "polygon", "cluster", "sparse", "plane", "thin"] as const;
const other = mk();
buildToolPalette(other as unknown as HTMLElement, store, { setTool } as unknown as PanelActions);
buildPalette(palette as unknown as HTMLElement, store, { setTool }, pill as unknown as HTMLElement);
beforeEach(() => {
  setTool.mockClear();
  store.set({ ...createAppStore().get(), session: sessionFixture() });
});

test("UI-1161 buildPalette builds the six icon buttons in order with the old ids, names and tooltips; buildToolPalette no longer holds them", () => {
  expect(palette.children.map((c) => c.getAttribute("data-control"))).toEqual(IDS);
  IDS.forEach((id, i) => {
    const b = palette.children[i];
    expect(b.tag).toBe("button");
    expect(b.classList.contains("tb")).toBe(true);
    expect(b.classList.contains("ib")).toBe(true);
    expect(b.children.map((c) => c.tag)).toEqual(["svg"]);
    expect(b.getAttribute("aria-label")).toBe(describeControls().find((d) => d.id === id)?.label);
    expect(b.getAttribute("aria-label")).toBe(NAMES[i]);
    expect(b.title).toBe(TOOLTIPS[id]);
  });
  for (const id of IDS) expect(other.control(id), id).toBeUndefined();
});

test("UI-1162 the palette follows the tool, the session and the compare mode; a click arms, a second click on the armed button disarms", () => {
  store.set({ tool: "plane" });
  tools.forEach((t, i) => {
    const b = palette.children[i];
    expect(b.classList.contains("active")).toBe(t === "plane");
    expect(b.getAttribute("aria-pressed")).toBe(String(t === "plane"));
  });
  store.set({ tool: "none" });
  const plane = palette.control("tool-plane")!;
  plane.fire("click");
  expect(setTool).toHaveBeenLastCalledWith("plane");
  store.set({ tool: "plane" });
  plane.fire("click");
  expect(setTool).toHaveBeenLastCalledWith("none");
  store.set({ session: null, tool: "none" });
  for (const c of palette.children) expect(c.disabled).toBe(true);
  store.set({ session: sessionFixture(), compare: "original" });
  for (const c of palette.children) {
    expect(c.disabled).toBe(true);
    expect(c.title.endsWith("(disabled: return to the edited view to edit)")).toBe(true);
  }
  store.set({ compare: "edited" });
  for (const c of palette.children) expect(c.disabled).toBe(false);
});

test("UI-1163 the arm pill is hidden while idle and reads '<Name> · Esc to exit' with Esc in a kbd for all six tools", () => {
  store.set({ tool: "none" });
  expect(pill.hidden).toBe(true);
  tools.forEach((t, i) => {
    store.set({ tool: t });
    expect(pill.hidden, t).toBe(false);
    expect(pill.text()).toBe(`${NAMES[i]} · Esc to exit`);
    expect(pill.all().find((e) => e.tag === "kbd")?.text()).toBe("Esc");
  });
  store.set({ tool: "none" });
  expect(pill.hidden).toBe(true);
});
