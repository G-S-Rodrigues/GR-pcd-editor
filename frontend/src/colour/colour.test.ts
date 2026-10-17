import { expect, test } from "vitest";
import type { FieldInfo } from "../state/types";
import { colourize, colourOptions, decodePackedRgb, heightRamp } from "./modes";
import { PALETTE } from "./palette";

const f = (name: string, type = "F", size = 4): FieldInfo => ({ name, type, size, count: 1 });
const XYZ = [f("x"), f("y"), f("z")];

test("UI-17 options come from the schema; absent fields are disabled with a reason", () => {
  const none = colourOptions(XYZ);
  expect(none.find((o) => o.id === "height")?.enabled).toBe(true);
  expect(none.find((o) => o.id === "flat")?.enabled).toBe(true);
  for (const id of ["rgb", "intensity"]) {
    const o = none.find((x) => x.id === id);
    expect(o?.enabled).toBe(false);
    expect(o?.reason).toMatch(/no .*field/i);
  }
  const rgb = colourOptions([...XYZ, f("rgba", "U")]);
  expect(rgb.find((o) => o.id === "rgb")).toMatchObject({ enabled: true, attr: "rgba" });
  const inten = colourOptions([...XYZ, f("intensity")]);
  expect(inten.find((o) => o.id === "intensity")).toMatchObject({ enabled: true, attr: "intensity" });
});

test("UI-17 height ramp spans bounds min/max and is clamped", () => {
  expect(heightRamp(-5, -5, 5)).toEqual(heightRamp(-100, -5, 5));
  expect(heightRamp(5, -5, 5)).toEqual(heightRamp(100, -5, 5));
  expect(heightRamp(0, -5, 5)).not.toEqual(heightRamp(5, -5, 5));
  expect(heightRamp(1, 2, 2)).toHaveLength(3); // zero range is finite
  expect(heightRamp(1, 2, 2).every(Number.isFinite)).toBe(true);
});

test("UI-17 packed RGB decodes 0xRRGGBB from float32 or uint32 bits, alpha ignored", () => {
  const u = new Uint32Array([0xff8040, 0x7fff8040 & 0xffffffff, 0x01ff0000]);
  expect(decodePackedRgb(u, 0)).toEqual([1, 128 / 255, 64 / 255]);
  expect(decodePackedRgb(u, 1)).toEqual([1, 128 / 255, 64 / 255]);
  expect(decodePackedRgb(u, 2)).toEqual([1, 0, 0]);
  const asF = new Float32Array(new Uint32Array([0x00ff8040]).buffer);
  expect(decodePackedRgb(new Uint32Array(asF.buffer), 0)).toEqual([1, 128 / 255, 64 / 255]);
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

test("UI-17 rgb and intensity modes use the attr block", () => {
  const attr = new Uint32Array([0xff0000, 0x00ff00]);
  const base = { coords: new Float32Array(6), flags: new Uint8Array(2), count: 2, origin: [0, 0, 0] as [number, number, number] };
  const rgb = colourize({ ...base, attr, attrKind: "u32" }, { mode: "rgb", bounds: null, markDeleted: false });
  expect([...rgb.slice(0, 6)]).toEqual([1, 0, 0, 0, 1, 0]);
  const inten = colourize(
    { ...base, attr: new Float32Array([0, 10]), attrKind: "f32" },
    { mode: "intensity", bounds: null, markDeleted: false },
  );
  expect(inten[0]).toBeLessThan(inten[3]);
});
