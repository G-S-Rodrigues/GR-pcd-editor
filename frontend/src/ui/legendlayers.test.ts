import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { createAppStore } from "../state/app";
import { layerRows } from "../layers/model";
import { FakeEl, installFakeDom } from "../testing/fakedom";
import { sessionFixture } from "../testing/fixtures";
import type { Layer } from "../state/types";
import { buildLegend, legendEntries } from "./legend";

const layer = (over: Partial<Layer>): Layer => ({ id: 1, name: "Floor", colour: 0, visible: true, count: 30, bounds: null, ...over });
const L = [layer({}), layer({ id: 2, name: "Wall", colour: 1, visible: false, count: 20 })];

test("UI-839 legendEntries takes layer rows as an optional 4th argument; without it the rows are exactly as before", () => {
  const plain = legendEntries().map((e) => e.id);
  expect(legendEntries(false, null, undefined, []).map((e) => e.id)).toEqual(plain);
  const withL = legendEntries(false, null, undefined, layerRows(sessionFixture({ layers: L })));
  expect(withL.map((e) => e.id)).toEqual([...plain, "layer-1", "layer-2"]);
  expect(withL.find((e) => e.id === "layer-1")?.label).toBe("Floor (30)");
});

let dom: ReturnType<typeof installFakeDom>;
const store = createAppStore();
const toggle = vi.fn();
const root = () => dom.root;
const items = () => root().all().filter((e) => e.getAttribute("data-legend-layer") !== null);
beforeAll(() => {
  dom = installFakeDom();
  buildLegend(root() as unknown as HTMLElement, store, new FakeEl("div") as unknown as HTMLElement, () => undefined, toggle);
});
afterAll(() => dom.restore());

test("UI-840 each layer gets a legend row with a colour chip and an eye toggle (aria-pressed) that asks to flip that layer", () => {
  expect(items()).toHaveLength(0);
  store.set({ session: sessionFixture({ layers: L }) });
  expect(items().map((e) => e.getAttribute("data-legend-layer"))).toEqual(["1", "2"]);
  const eye = (id: string) => root().all().find((e) => e.getAttribute("data-legend-eye") === id) as FakeEl;
  expect(eye("1").getAttribute("aria-pressed")).toBe("true");
  expect(eye("2").getAttribute("aria-pressed")).toBe("false");
  expect(eye("2").getAttribute("aria-label")).toBe("Show layer Wall");
  eye("2").fire("click");
  expect(toggle).toHaveBeenCalledWith(2);
  store.set({ session: sessionFixture() });
  expect(items()).toHaveLength(0);
});

test("UI-841 the layer rows are not rebuilt by an unrelated store change (a click between mousedown and mouseup survives)", () => {
  store.set({ session: sessionFixture({ layers: L }) });
  const before = items()[0];
  store.set({ legendOpen: false });
  expect(items()[0]).toBe(before);
});

test("UI-1015 a protected layer's legend entry carries layer.protected and a shield element; an unprotected one has none; a flag flip rebuilds the row", () => {
  const rows = layerRows(sessionFixture({ layers: [layer({ protected: true }), layer({ id: 2, name: "Wall", colour: 1 })] }));
  const entries = legendEntries(false, null, undefined, rows);
  expect(entries.find((e) => e.id === "layer-1")?.layer?.protected).toBe(true);
  expect(entries.find((e) => e.id === "layer-2")?.layer?.protected).toBe(false);
  store.set({ session: sessionFixture({ layers: [layer({ protected: true }), layer({ id: 2, name: "Wall", colour: 1 })] }) });
  const shields = (id: string) => items().find((e) => e.getAttribute("data-legend-layer") === id)!.all().filter((e) => e.getAttribute("data-legend-shield") !== null);
  expect(shields("1")).toHaveLength(1);
  expect(shields("1")[0].getAttribute("aria-label")).toBe("Protected");
  expect(shields("1")[0].all().some((e) => e.tag === "svg")).toBe(true);
  expect(shields("2")).toHaveLength(0);
  store.set({ session: sessionFixture({ layers: [layer({ protected: false }), layer({ id: 2, name: "Wall", colour: 1 })] }) });
  expect(shields("1")).toHaveLength(0);
});
