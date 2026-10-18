import { expect, test } from "vitest";
import { TOOLTIPS } from "../ui/tooltips";
import { createAppStore } from "../state/app";
import type { FieldInfo } from "../state/types";
import { colourize, colourOptions, heightRamp } from "./modes";
import { PALETTE } from "./palette";
import { DISTANCE_HEX, RAMP_STOPS, TURBO_HEX, VIRIDIS_HEX, cssGradient, rampAt, rampLegend } from "./ramps";

// the approved gradients, copied from review/symbol-sheet.html (colour modes table), not from the module under test
const SHEET_TURBO = ["#30123b", "#4662d7", "#36aaf9", "#1ae4b6", "#72fe5e", "#c7ef34", "#faba39", "#f66b19", "#cb2a04", "#7a0403"];
const SHEET_VIRIDIS = ["#440154", "#414487", "#2a788e", "#22a884", "#7ad151", "#fde725"];
const SHEET_DISTANCE = ["#ffe9a8", "#f2a35e", "#a64d79", "#3a2f7a", "#1b2a6b"];
const rgb = (h: string) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255);
const f = (name: string): FieldInfo => ({ name, type: "F", size: 4, count: 1 });

/** Independent piecewise-linear gradient over hex stops, 0..1. */
function sheetAt(hex: string[], t: number): number[] {
  const x = Math.min(1, Math.max(0, t)) * (hex.length - 1);
  const i = Math.min(hex.length - 2, Math.floor(x));
  const a = rgb(hex[i]);
  const b = rgb(hex[i + 1]);
  return a.map((v, k) => v + (b[k] - v) * (x - i));
}

test("UI-360 the Turbo, Viridis and Distance stop tables equal the approved sheet and 11 samples are within 1/255 of its gradient", () => {
  expect(TURBO_HEX).toEqual(SHEET_TURBO);
  expect(VIRIDIS_HEX).toEqual(SHEET_VIRIDIS);
  expect(DISTANCE_HEX).toEqual(SHEET_DISTANCE);
  for (const [id, hex] of [["turbo", SHEET_TURBO], ["viridis", SHEET_VIRIDIS], ["distance", SHEET_DISTANCE]] as const) {
    expect(RAMP_STOPS[id]).toHaveLength(hex.length);
    for (let k = 0; k <= 10; k++) {
      const got = rampAt(RAMP_STOPS[id], k / 10);
      const want = sheetAt(hex, k / 10);
      got.forEach((v, c) => expect(Math.abs(v - want[c]), `${id} t=${k / 10} ch=${c}`).toBeLessThan(1 / 255));
    }
  }
  expect(cssGradient(RAMP_STOPS.turbo)).toBe(`linear-gradient(90deg, ${SHEET_TURBO.join(", ")})`);
});

test("UI-361 heightRamp takes explicit stops (default Turbo); clamping and a zero range are as before", () => {
  expect(heightRamp(0, -5, 5)).toEqual(heightRamp(0, -5, 5, RAMP_STOPS.turbo));
  expect(heightRamp(0, -5, 5)).not.toEqual(heightRamp(0, -5, 5, RAMP_STOPS.viridis));
  expect(heightRamp(-5, -5, 5, RAMP_STOPS.viridis)).toEqual(rampAt(RAMP_STOPS.viridis, 0));
  expect(heightRamp(99, -5, 5, RAMP_STOPS.viridis)).toEqual(rampAt(RAMP_STOPS.viridis, 1));
  expect(heightRamp(1, 2, 2, RAMP_STOPS.viridis)).toEqual(rampAt(RAMP_STOPS.viridis, 0.5));
});

test("UI-362 the colour options are exactly Turbo, Viridis and Grey (id flat), all enabled whatever the file holds", () => {
  for (const schema of [[f("x"), f("y"), f("z")], [f("x"), f("y"), f("z"), f("rgb"), f("intensity")]]) {
    const o = colourOptions(schema);
    expect(o.map((x) => x.id)).toEqual(["turbo", "viridis", "flat"]);
    expect(o.map((x) => x.label)).toEqual(["Height (Turbo)", "Height (Viridis)", "Grey"]);
    for (const x of o) {
      expect(x.enabled).toBe(true);
      expect(x.attr).toBeUndefined();
    }
  }
});

test("UI-363 colourize: Turbo and Viridis differ for one z, Grey is the base colour, flags still override", () => {
  const coords = new Float32Array([0, 0, 0.3, 0, 0, 0.3, 0, 0, 0.3, 0, 0, 0.3, 0, 0, 0.3]);
  const flags = new Uint8Array([0, 1, 2, 4, 8]);
  const base = { coords, flags, count: 5, origin: [0, 0, 0] as [number, number, number] };
  const bounds = { min: [0, 0, 0] as [number, number, number], max: [0, 0, 1] as [number, number, number] };
  const run = (mode: "turbo" | "viridis" | "flat") => colourize(base, { mode, bounds, markDeleted: true });
  const px = (a: Float32Array, i: number) => [...a.slice(3 * i, 3 * i + 3)];
  const t = run("turbo");
  const v = run("viridis");
  const g = run("flat");
  expect(px(t, 0)).not.toEqual(px(v, 0));
  expect(px(t, 0)).toEqual(heightRamp(0.3, 0, 1, RAMP_STOPS.turbo).map(Math.fround));
  expect(px(g, 0)).toEqual([...PALETTE.base].map(Math.fround));
  for (const out of [t, v, g]) {
    expect(px(out, 1)).toEqual([...PALETTE.selected].map(Math.fround));
    expect(px(out, 2)).toEqual([...PALETTE.protected].map(Math.fround));
    expect(px(out, 3)).toEqual([...PALETTE.deleted].map(Math.fround));
    expect(px(out, 4)).toEqual([...PALETTE.previewAdd].map(Math.fround));
  }
});

test("UI-364 the default colour mode is turbo", () => {
  expect(createAppStore().get().colour.mode).toBe("turbo");
});

test("UI-366 rampLegend: the stops are the active table, lo and hi are the bounds in Z, flat has none", () => {
  const bounds = { min: [0, 0, -1.5] as [number, number, number], max: [0, 0, 4.25] as [number, number, number] };
  const t = rampLegend("turbo", bounds, "m");
  expect(t?.stops).toBe(RAMP_STOPS.turbo);
  expect(t?.minLabel).toBe("-1.5 m");
  expect(t?.maxLabel).toBe("4.25 m");
  expect(rampLegend("viridis", bounds, "m")?.stops).toBe(RAMP_STOPS.viridis);
  expect(rampLegend("viridis", bounds, "m")?.title).toMatch(/Viridis/);
  expect(rampLegend("flat", bounds, "m")).toBeNull();
  expect(rampLegend("turbo", null, "m")?.minLabel).toBe("low");
});

test("UI-367 the colour-mode tooltip no longer names RGB or intensity and names the three modes", () => {
  const tip = TOOLTIPS["colour-mode"];
  expect(tip).not.toMatch(/rgb|intensity/i);
  expect(tip).toMatch(/Turbo/);
  expect(tip).toMatch(/Viridis/);
  expect(tip).toMatch(/grey/i);
});
