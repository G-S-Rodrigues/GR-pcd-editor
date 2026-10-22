import { afterAll, beforeAll, expect, test } from "vitest";
import { createAppStore } from "../state/app";
import { sessionFixture } from "../testing/fixtures";
import { FakeEl, installFakeDom } from "../testing/fakedom";
import { describeControls } from "./describe";
import { buildBandPill } from "./bandpill";
import { TOOLTIPS } from "./tooltips";

let dom: ReturnType<typeof installFakeDom>;
let stage: FakeEl;
const store = createAppStore();
const pill = () => stage.all().find((e) => e.getAttribute("id") === "band-pill" || e.attrs.get("data-control") === "band-pill") as FakeEl;
const show = () => dom.root.control("band-pill-show") as FakeEl;

beforeAll(() => {
  dom = installFakeDom();
  stage = dom.root;
  buildBandPill(stage as unknown as HTMLElement, store);
});
afterAll(() => dom.restore());

test("UI-1071 the band pill: hidden while the band is shown or no slab is on, otherwise exactly Protection on band hidden with a Show button that shows the band again", () => {
  const on = (m: { global: { enabled: boolean; min: number; max: number } }) => ({ ...store.get().tools, protection: { ...store.get().tools.protection, ...m } });
  store.set({ session: sessionFixture(), tools: on({ global: { enabled: true, min: 1, max: 2 } }), bandVisible: true });
  expect(pill().hidden).toBe(true);
  store.set({ bandVisible: false, tools: on({ global: { enabled: false, min: 1, max: 2 } }) });
  expect(pill().hidden).toBe(true); // nothing to be hidden: no interval on
  store.set({ tools: on({ global: { enabled: true, min: 1, max: 2 } }) });
  expect(pill().hidden).toBe(false);
  expect(pill().text()).toContain("Protection on · band hidden");
  expect(show().tag).toBe("button");
  expect(show().text()).toBe("Show");
  expect(show().title).toBe(TOOLTIPS["band-pill-show"]);
  expect(TOOLTIPS["band-pill-show"].length).toBeGreaterThan(10);
  expect(describeControls().find((d) => d.id === "band-pill-show")).toMatchObject({ label: "Show band", group: "display" });
  show().fire("click");
  expect(store.get().bandVisible).toBe(true);
  expect(pill().hidden).toBe(true);
  store.set({ session: null, bandVisible: false });
  expect(pill().hidden).toBe(true); // no session, no pill
});
