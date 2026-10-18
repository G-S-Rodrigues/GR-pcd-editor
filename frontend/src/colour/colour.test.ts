import { expect, test } from "vitest";
import type { FieldInfo } from "../state/types";
import { colourize, colourOptions, heightRamp } from "./modes";
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
