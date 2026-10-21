import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { createAppStore } from "../state/app";
import { FakeEl, installFakeDom } from "../testing/fakedom";
import { LEGEND_BOX } from "../view/layout";
import { sessionFixture } from "../testing/fixtures";
import { describeControls } from "./describe";
import { buildLegend, legendEntries } from "./legend";
import { TOOLTIPS } from "./tooltips";

let dom: ReturnType<typeof installFakeDom>;
let root: FakeEl;
const store = createAppStore();
const onShow = vi.fn();
const chip = () => root.control("hidden-chip") as FakeEl;
const some = (n: number) => sessionFixture({ counts: { ...sessionFixture().counts, hidden: n } });

beforeAll(() => {
  dom = installFakeDom();
  root = dom.root;
  buildLegend(root as unknown as HTMLElement, store, new FakeEl("div") as unknown as HTMLElement, onShow);
});
afterAll(() => dom.restore());

test("UI-515 the chip is hidden while nothing is hidden, then reads N hidden - Show; a click asks to show the points again", () => {
  expect(chip().hidden).toBe(true);
  store.set({ session: some(1234) });
  expect(chip().hidden).toBe(false);
  expect(chip().text()).toBe("1,234 hidden - Show");
  expect(chip().tag).toBe("button");
  expect(chip().title).toBe(TOOLTIPS["hidden-chip"]);
  expect(describeControls().find((d) => d.id === "hidden-chip")?.label).toBeTruthy();
  chip().fire("click");
  expect(onShow).toHaveBeenCalledTimes(1);
  store.set({ session: some(0) });
  expect(chip().hidden).toBe(true);
});

test("UI-516 the legend box keeps its place and size and its rows are unchanged with and without the chip", () => {
  const rows = () => root.all().filter((e) => e.getAttribute("data-legend")).map((e) => e.getAttribute("data-legend"));
  const before = { l: root.style.left, t: root.style.top, w: root.style.width, h: root.style.maxHeight };
  store.set({ session: some(5) });
  expect({ l: root.style.left, t: root.style.top, w: root.style.width, h: root.style.maxHeight }).toEqual(before);
  expect(before).toEqual({ l: `${LEGEND_BOX.left}px`, t: `${LEGEND_BOX.top}px`, w: `${LEGEND_BOX.w}px`, h: `${LEGEND_BOX.maxH}px` });
  expect(rows()).toEqual(legendEntries().map((e) => e.id));
  // it stays visible when the menu is folded (the reminder must not vanish with the body)
  store.set({ legendOpen: false });
  expect(chip().hidden).toBe(false);
});
