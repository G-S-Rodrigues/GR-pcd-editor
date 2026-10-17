import { describe, expect, it } from "vitest";
import { colourize } from "./modes";
import { PALETTE } from "./palette";

const input = (zs: number[], flags: number[]) => ({
  coords: new Float32Array(zs.flatMap((z) => [0, 0, z])),
  flags: new Uint8Array(flags),
  count: zs.length,
  origin: [0, 0, 0] as [number, number, number],
});
const ctx = { mode: "flat" as const, bounds: null, markDeleted: false };
const rgb = (a: Float32Array, i: number) => [a[3 * i], a[3 * i + 1], a[3 * i + 2]].map((v) => Math.round(v * 255));
const px = (c: readonly number[]) => c.map((v) => Math.round(v * 255));
const region = { intervals: [{ min: 1, max: 2 }] };

describe("colourize with a protection region", () => {
  it("UI-212 unselected points inside the slab are strong, outside stay as before", () => {
    const out = colourize(input([0.5, 1, 1.5, 2, 2.5], [0, 0, 0, 0, 0]), { ...ctx, region });
    expect([0, 1, 2, 3, 4].map((i) => rgb(out, i))).toEqual([px(PALETTE.base), px(PALETTE.protectedStrong), px(PALETTE.protectedStrong), px(PALETTE.protectedStrong), px(PALETTE.base)]);
  });

  it("UI-212 selected points outside the slab stay orange; kept points are strong; selected inside the slab but not kept stay orange", () => {
    const out = colourize(input([0.5, 1.5, 1.5], [1, 2, 1]), { ...ctx, region });
    expect(rgb(out, 0)).toEqual(px(PALETTE.selected));
    expect(rgb(out, 1)).toEqual(px(PALETTE.protectedStrong));
    expect(rgb(out, 2)).toEqual(px(PALETTE.selected));
  });

  it("UI-212 without a region (section collapsed) the colours are today's, kept points use the normal protected colour", () => {
    const out = colourize(input([1.5, 1.5], [0, 2]), ctx);
    expect(rgb(out, 0)).toEqual(px(PALETTE.base));
    expect(rgb(out, 1)).toEqual(px(PALETTE.protected));
  });

  it("UI-212 several intervals all count, and the origin offset is added to the coordinates", () => {
    const r = input([0.5, 0.5], [0, 0]);
    r.origin = [0, 0, 10];
    const out = colourize(r, { ...ctx, region: { intervals: [{ min: 10, max: 11 }, { min: 20, max: 21 }] } });
    expect(rgb(out, 0)).toEqual(px(PALETTE.protectedStrong));
  });

  it("UI-212 the strong colour differs from the normal protected colour and the slab colour", () => {
    expect(px(PALETTE.protectedStrong)).not.toEqual(px(PALETTE.protected));
    expect(px(PALETTE.protectedStrong)).not.toEqual(px(PALETTE.slab));
    expect(px(PALETTE.protectedStrong)).toEqual([0, 240, 255]);
  });
});
