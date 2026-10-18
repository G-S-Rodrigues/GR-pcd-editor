import { expect, test } from "vitest";
import { createAppStore } from "../state/app";
import { restoreClientState } from "../state/persist";
import { createRefresher } from "../orchestration/refresh";
import { layerColourKey } from "./key";
import { colourOptions, colourizeMasked } from "./modes";
import { PALETTE } from "./palette";
import { NORMAL_ATTR, decodeNormal, normalColour, normalSwatches } from "./normals";
import { rampLegend } from "./ramps";

// words produced by the backend octahedral packing (backend oct_pack) for these unit vectors
const TABLE: [number, [number, number, number]][] = [
  [2147516416, [0, 0, 1]],
  [2147549183, [1, 0, 0]],
  [4294934528, [0, 1, 0]],
  [4294967295, [0, 0, -1]],
  [3374514175, [0.6, 0, -0.8]],
];

test("UI-380 decodeNormal equals the backend packing table; +Z maps to a blue-ish colour, +X red-ish, +Y green-ish", () => {
  for (const [w, v] of TABLE) {
    const n = decodeNormal(w);
    for (let k = 0; k < 3; k++) expect(n[k], `${w}[${k}]`).toBeCloseTo(v[k], 3);
    expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 4);
  }
  const [r, g, b] = normalColour([0, 0, 1]);
  expect(b).toBeGreaterThan(r);
  expect(b).toBeGreaterThan(g);
  expect(normalColour([1, 0, 0])[0]).toBeGreaterThan(normalColour([1, 0, 0])[2]);
  expect(normalColour([0, 1, 0])[1]).toBeGreaterThan(normalColour([0, 1, 0])[0]);
});

test("UI-380 colourize in normals mode colours by the decoded normal; flags still override; no attr falls back to the base grey", () => {
  const coords = new Float32Array(9);
  const flags = new Uint8Array([0, 0, 1]);
  const attr = new Uint32Array([2147516416, 2147549183, 2147516416]);
  const ctx = { mode: "normals" as const, bounds: null, markDeleted: false };
  const { colours, ovr } = colourizeMasked({ coords, flags, count: 3, origin: [0, 0, 0], attr, attrKind: "u32" }, ctx);
  const px = (i: number) => [...colours.slice(i * 3, i * 3 + 3)];
  normalColour([0, 0, 1]).forEach((v, k) => expect(px(0)[k]).toBeCloseTo(v, 3));
  expect(px(1)[0]).toBeGreaterThan(px(1)[2]);
  expect(px(2)).toEqual([...PALETTE.selected].map(Math.fround));
  expect([...ovr]).toEqual([0, 0, 1]);
  const none = colourizeMasked({ coords, flags, count: 3, origin: [0, 0, 0] }, ctx);
  expect([...none.colours.slice(0, 3)]).toEqual([...PALETTE.base].map(Math.fround));
});

test("UI-381 the normals option is enabled on any schema and asks the render for @normal; no other mode does", () => {
  const o = colourOptions([]);
  const n = o.find((x) => x.id === "normals");
  expect(n?.enabled).toBe(true);
  expect(n?.label).toBe("Normal shading");
  expect(n?.attr).toBe(NORMAL_ATTR);
  expect(NORMAL_ATTR).toBe("@normal");
  expect(o.filter((x) => x.attr !== undefined).map((x) => x.id)).toEqual(["normals"]);
});

test("UI-381 refresh passes attr @normal only in normals mode, and the colour key follows the mode", async () => {
  const store = createAppStore();
  store.set({ renderMode: "original", budget: 1000, colour: { mode: "normals", pointSize: 2 }, session: { schema: [], revision: { cloud: 1 } } as never });
  const calls: (string | undefined)[] = [];
  const data = { count: 1, coords: new Float32Array(3), flags: new Uint8Array(1), origin: [0, 0, 0] } as never;
  const r = createRefresher(store, (async (_m: string, _b: number, a: string | undefined) => (calls.push(a), data)) as never);
  await r.refresh();
  store.set({ colour: { mode: "turbo", pointSize: 2 } });
  await r.refresh();
  expect(calls).toEqual(["@normal", undefined]);
  const a = layerColourKey(store.get(), false);
  store.set({ colour: { mode: "normals", pointSize: 2 } });
  expect(layerColourKey(store.get(), false)).not.toBe(a);
});

test("UI-382 the legend of normals is the X/Y/Z swatch triple, labelled, with the axis colours of the mode; Grey has none", () => {
  const l = rampLegend("normals", null);
  expect(l?.id).toBe("normals");
  expect(l?.swatches?.map((s) => s.label)).toEqual(["X", "Y", "Z"]);
  expect(l?.swatches).toEqual(normalSwatches());
  expect(l?.swatches?.[2].colour).toEqual(normalColour([0, 0, 1]));
  expect(l?.title).toBe("Normal shading");
  expect(rampLegend("flat", null)).toBeNull();
});

test("UI-383 a saved normals mode restores", () => {
  const p = restoreClientState({ v: 1, colour: "normals", pointSize: 3 });
  expect(p?.colour).toEqual({ mode: "normals", pointSize: 3 });
});
