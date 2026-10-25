import { expect, test } from "vitest";
import type { FieldInfo } from "../state/types";
import { createAppStore } from "../state/app";
import { sessionFixture } from "../testing/fixtures";
import { layerColourKey } from "./key";
import { colourize, colourOptions, colourOptionsFor, colourizeMasked, heightRamp, layerPaletteRgb } from "./modes";
import { PALETTE } from "./palette";

const f = (name: string, type = "F", size = 4): FieldInfo => ({ name, type, size, count: 1 });
const XYZ = [f("x"), f("y"), f("z")];

test("UI-17 options are Turbo, Viridis, Grey, Distance to viewer and Normal shading, all enabled, whatever the schema holds", () => {
  for (const schema of [XYZ, [...XYZ, f("rgba", "U"), f("intensity")]]) {
    const o = colourOptions(schema);
    expect(o.map((x) => x.id)).toEqual(["turbo", "viridis", "flat", "distance", "normals"]);
    expect(o.every((x) => x.enabled && (x.id === "normals" ? x.attr === "@normal" : x.attr === undefined))).toBe(true);
  }
});

test("UI-17 height ramp spans bounds min/max and is clamped", () => {
  expect(heightRamp(-5, -5, 5)).toEqual(heightRamp(-100, -5, 5));
  expect(heightRamp(5, -5, 5)).toEqual(heightRamp(100, -5, 5));
  expect(heightRamp(0, -5, 5)).not.toEqual(heightRamp(5, -5, 5));
  expect(heightRamp(1, 2, 2)).toHaveLength(3); // zero range is finite
  expect(heightRamp(1, 2, 2).every(Number.isFinite)).toBe(true);
});

test("UI-17 flags override the base colour with the palette", () => {
  const coords = new Float32Array(12); // z all 0
  const flags = new Uint8Array([0, 1, 2, 4]);
  const out = colourize(
    { coords, flags, count: 4, origin: [0, 0, 0] },
    { mode: "flat", bounds: { min: [0, 0, -1], max: [0, 0, 1] }, markDeleted: true },
  );
  const f32 = (c: readonly number[]) => c.map(Math.fround);
  const px = (i: number) => [...out.slice(i * 3, i * 3 + 3)];
  expect(px(1)).toEqual(f32(PALETTE.selected));
  expect(px(2)).toEqual(f32(PALETTE.protected));
  expect(px(3)).toEqual(f32(PALETTE.deleted));
  expect(px(0)).toEqual(f32(PALETTE.base));
  const noDel = colourize(
    { coords, flags, count: 4, origin: [0, 0, 0] },
    { mode: "flat", bounds: null, markDeleted: false },
  );
  expect([...noDel.slice(9, 12)]).toEqual(f32(PALETTE.base));
});

test("UI-852 colourOptionsFor is the five modes for a layer-less session and adds an enabled Layers entry (no render attribute) when the session has layers", () => {
  expect(colourOptionsFor(XYZ, false).map((x) => x.id)).toEqual(["turbo", "viridis", "flat", "distance", "normals"]);
  const o = colourOptionsFor(XYZ, true);
  expect(o.map((x) => x.id)).toEqual(["turbo", "viridis", "flat", "distance", "normals", "layers"]);
  expect(o[5]).toMatchObject({ label: "Layers", enabled: true });
  expect(o[5].attr).toBeUndefined();
});

const PT = (n: number) => ({ coords: new Float32Array(n * 3), flags: new Uint8Array(n), count: n, origin: [0, 0, 0] as [number, number, number] });

test("UI-853 Layers mode: sub layer points take their layer colour by colour index, main stays grey, and the selected, protected and preview colours still win", () => {
  const rgb = layerPaletteRgb([
    { id: 1, name: "A", colour: 0, visible: true, count: 1, bounds: null },
    { id: 4, name: "B", colour: 2, visible: true, count: 1, bounds: null },
  ]);
  const r = { ...PT(6), layer: new Uint8Array([0, 1, 4, 1, 1, 1]) };
  r.flags = new Uint8Array([0, 0, 0, 1, 2, 8]); // main, A, B, selected, protected, preview-add
  const { colours, ovr } = colourizeMasked(r, { mode: "layers", bounds: null, markDeleted: false, layerRgb: rgb });
  const at = (i: number) => [...colours.slice(3 * i, 3 * i + 3)];
  const f = (c: readonly number[]) => c.map(Math.fround);
  expect(at(0)).toEqual(f(PALETTE.base));
  expect(at(1)).toEqual(f(rgb[1]!));
  expect(at(2)).toEqual(f(rgb[4]!));
  expect(rgb[1]).not.toEqual(rgb[4]);
  expect(at(3)).toEqual(f(PALETTE.selected));
  expect(at(4)).toEqual(f(PALETTE.protected));
  expect(at(5)).toEqual(f(PALETTE.previewAdd));
  expect([...ovr]).toEqual([0, 0, 0, 1, 1, 1]);
});

test("UI-854 Layers mode with no layer block or an unknown id falls back to the base grey; the other modes ignore a layer block", () => {
  const rgb = layerPaletteRgb([{ id: 1, name: "A", colour: 0, visible: true, count: 1, bounds: null }]);
  const grey = [...PALETTE.base].map(Math.fround);
  const none = colourizeMasked(PT(2), { mode: "layers", bounds: null, markDeleted: false, layerRgb: rgb }).colours;
  expect([...none.slice(0, 3)]).toEqual(grey);
  const r = { ...PT(2), layer: new Uint8Array([9, 1]) };
  const out = colourizeMasked(r, { mode: "layers", bounds: null, markDeleted: false, layerRgb: rgb }).colours;
  expect([...out.slice(0, 3)]).toEqual(grey);
  const flat = colourizeMasked(r, { mode: "flat", bounds: null, markDeleted: false, layerRgb: rgb }).colours;
  expect([...flat.slice(3, 6)]).toEqual(grey);
});

test("UI-855 the colour cache key follows the layer colours only in Layers mode", () => {
  const st = (mode: "turbo" | "layers", colour: number) => {
    const s = createAppStore().get();
    return { ...s, colour: { ...s.colour, mode }, session: sessionFixture({ layers: [{ id: 1, name: "A", colour, visible: true, count: 1, bounds: null }] }) };
  };
  expect(layerColourKey(st("layers", 0), false)).not.toBe(layerColourKey(st("layers", 1), false));
  expect(layerColourKey(st("turbo", 0), false)).toBe(layerColourKey(st("turbo", 1), false));
});

// ---- 22-2 (R22-3): a layer's points keep the layer colour inside the protected slab
const SLAB = { intervals: [{ min: -1, max: 1 }] };
const layerA = (colour: number) => layerPaletteRgb([{ id: 1, name: "A", colour, visible: true, count: 1, bounds: null, protected: true }]);

test("UI-1010 Layers mode with a slab region: a layer point draws its layer colour, main and unknown-id points stay the strong slab colour, the kept, selected and preview flags still win", () => {
  const rgb = layerA(0);
  const r = { ...PT(8), layer: new Uint8Array([0, 1, 9, 1, 1, 1, 1, 1]) }; // every z is 0, inside the slab
  r.flags = new Uint8Array([0, 0, 0, 2, 1, 8, 16, 4]); // main, layer, unknown id, kept, selected, preview-add, preview-remove, deleted
  const { colours, ovr } = colourizeMasked(r, { mode: "layers", bounds: null, markDeleted: true, layerRgb: rgb, region: SLAB });
  const at = (i: number) => [...colours.slice(3 * i, 3 * i + 3)];
  const f = (c: readonly number[]) => c.map(Math.fround);
  expect(at(0)).toEqual(f(PALETTE.protectedStrong));
  expect(at(1)).toEqual(f(rgb[1]!));
  expect(at(2)).toEqual(f(PALETTE.protectedStrong));
  expect(at(3)).toEqual(f(PALETTE.protectedStrong));
  expect(at(4)).toEqual(f(PALETTE.selected));
  expect(at(5)).toEqual(f(PALETTE.previewAdd));
  expect(at(6)).toEqual(f(PALETTE.previewRemove));
  expect(at(7)).toEqual(f(PALETTE.deleted));
  expect([...ovr]).toEqual([1, 0, 1, 1, 1, 1, 1, 1]);
});

test("UI-1011 a protected layer inside the slab follows its colour index, with and without a tilted slab", () => {
  const f = (c: readonly number[]) => c.map(Math.fround);
  for (const region of [SLAB, { ...SLAB, tilt: { rx: 2, ry: 3, pivot: [0, 0] as [number, number] } }]) {
    const r = { ...PT(1), layer: new Uint8Array([1]) };
    const first = colourizeMasked(r, { mode: "layers", bounds: null, markDeleted: false, layerRgb: layerA(0), region }).colours;
    const second = colourizeMasked(r, { mode: "layers", bounds: null, markDeleted: false, layerRgb: layerA(3), region }).colours;
    expect([...first]).toEqual(f(layerA(0)[1]!));
    expect([...second]).toEqual(f(layerA(3)[1]!));
    expect([...first]).not.toEqual([...second]);
  }
});

test("UI-1012 the other colour modes with a layer block and a slab region are unchanged: the point inside the slab stays the strong slab colour", () => {
  const rgb = layerA(0);
  const r = { ...PT(1), layer: new Uint8Array([1]) };
  for (const mode of ["flat", "turbo"] as const) {
    const out = colourizeMasked(r, { mode, bounds: { min: [0, 0, -1], max: [0, 0, 1] } as never, markDeleted: false, layerRgb: rgb, region: SLAB }).colours;
    expect([...out], mode).toEqual([...PALETTE.protectedStrong].map(Math.fround));
  }
});
