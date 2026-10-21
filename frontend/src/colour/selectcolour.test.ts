import { expect, test } from "vitest";
import { createAppStore } from "../state/app";
import { sessionFixture } from "../testing/fixtures";
import { layerColourKey } from "./key";
import { colourizeMasked } from "./modes";
import { PALETTE, rgbDistance } from "./palette";
import { RAMP_STOPS } from "./ramps";
import { DEFAULT_SELECTED, SELECTED_COLOURS, selectedRgb } from "./selectcolour";

const hexOf = (c: readonly number[]) => `#${c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;

test("UI-720 four presets: orange (default), magenta, white, lime, unique ids, default equals the palette selected colour", () => {
  expect(SELECTED_COLOURS.map((p) => p.id)).toEqual(["orange", "magenta", "white", "lime"]);
  expect(new Set(SELECTED_COLOURS.map((p) => p.id)).size).toBe(4);
  expect(new Set(SELECTED_COLOURS.map((p) => hexOf(p.colour))).size).toBe(4);
  expect(DEFAULT_SELECTED).toBe("orange");
  expect(selectedRgb(DEFAULT_SELECTED)).toEqual(PALETTE.selected);
  expect(selectedRgb("magenta")).toEqual(SELECTED_COLOURS[1].colour);
});

test("UI-721 contrast floors: every preset against the other point colours, the canvas clear colour and (non-default) every ramp stop", () => {
  const others = [PALETTE.base, PALETTE.protected, PALETTE.protectedStrong, PALETTE.slab, PALETTE.deleted, PALETTE.step, PALETTE.stepHover, PALETTE.previewAdd, PALETTE.previewRemove].map(hexOf);
  const stops = Object.values(RAMP_STOPS).flatMap((s) => s.map(hexOf));
  for (const p of SELECTED_COLOURS) {
    const c = hexOf(p.colour);
    for (const o of others) expect(rgbDistance(c, o), `${p.id} vs ${o}`).toBeGreaterThanOrEqual(60);
    expect(rgbDistance(c, "#15181d"), `${p.id} vs background`).toBeGreaterThanOrEqual(100);
    if (p.id !== "orange") for (const o of stops) expect(rgbDistance(c, o), `${p.id} vs ramp ${o}`).toBeGreaterThanOrEqual(80);
  }
});

test("UI-722 colourizeMasked paints selected points with ctx.selected; protected, preview and region keep their own; omitted = palette", () => {
  const coords = new Float32Array(15);
  const flags = new Uint8Array([1, 2, 8, 16, 0]);
  const base = { coords, flags, count: 5, origin: [0, 0, 0] as [number, number, number] };
  const ctx = { mode: "flat" as const, bounds: null, markDeleted: false };
  const f32 = (c: readonly number[]) => c.map(Math.fround);
  const px = (a: Float32Array, i: number) => [...a.slice(i * 3, i * 3 + 3)];
  const mag = selectedRgb("magenta");
  const m = colourizeMasked(base, { ...ctx, selected: mag }).colours;
  expect(px(m, 0)).toEqual(f32(mag));
  expect(px(m, 1)).toEqual(f32(PALETTE.protected));
  expect(px(m, 2)).toEqual(f32(PALETTE.previewAdd));
  expect(px(m, 3)).toEqual(f32(PALETTE.previewRemove));
  expect(px(m, 4)).toEqual(f32(PALETTE.base));
  expect(px(colourizeMasked(base, ctx).colours, 0)).toEqual(f32(PALETTE.selected));
});

test("UI-723 the layer colour key changes with the selected preset and is stable for the same one", () => {
  const a = { ...createAppStore().get(), session: sessionFixture() };
  const k = (id: "orange" | "magenta") => layerColourKey({ ...a, selectedColour: id }, false);
  expect(k("magenta")).not.toBe(k("orange"));
  expect(k("magenta")).toBe(k("magenta"));
});
