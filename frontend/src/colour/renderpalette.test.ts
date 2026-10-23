import { describe, expect, test } from "vitest";
import { overlayStyle } from "../compare/model";
import { legendEntries } from "../ui/legend";
import { createAppStore } from "../state/app";
import { sessionFixture } from "../testing/fixtures";
import { emptyTimeline, stepLayerStyle } from "../timeline/model";
import { layerColourKey } from "./key";
import { colourizeMasked } from "./modes";
import { LIGHT_PALETTE as LP, PALETTE as DP, gpuPalette, gpuRgb } from "./palette";
import { serialiseClientState } from "../state/persist";
import { AXIS_COLOUR, LIGHT_AXIS_COLOUR, axisColours } from "../filterboxes/plane";
import { blend } from "../timeline/overlay";
import { RING_TINT, dim } from "../tools/box/overlay";
import { LIGHT_DRAFT_OUTLINE, LIGHT_LIVE_OUTLINE, draftOutline, DRAFT_OUTLINE, LIVE_OUTLINE } from "../tools/draft";
import { LIGHT_FLOORS } from "../testing/floors";
import { BACKDROPS, solid } from "../testing/tokens";
import { applyRenderTheme, renderThemeOf } from "../viewport/canvastoken";
import { toolColours } from "../viewport/tools3d";
import { LIGHT_PALETTE, PALETTE, contrastRatio, paletteFor, rgbDistance } from "./palette";
import { LIGHT_MAIN_COLOUR } from "../layers/model";
import { RAMP_STOPS } from "./ramps";
import { SELECTED_COLOURS, selectedPresets, selectedRgb } from "./selectcolour";

const hexOf = (c: readonly number[]) => `#${c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
const num = (n: number): string => `#${n.toString(16).padStart(6, "0")}`;
const lightBacks = BACKDROPS.map((b) => solid("light", b));

describe("light render palette (part 22-4b, R22-14)", () => {
  test("UI-1102 the light point palette is the ruled set: same keys as PALETTE, 3:1 on both light backdrops, the step layers 3:1 as composited; dark is PALETTE itself", () => {
    expect(paletteFor("dark")).toBe(PALETTE);
    expect(Object.keys(LIGHT_PALETTE).sort()).toEqual(Object.keys(PALETTE).sort());
    const want: Record<keyof typeof PALETTE, string> = {
      base: "#878787", selected: "#be7715", protected: "#0092be", protectedStrong: "#00969f", slab: "#ab6bdb",
      deleted: "#e63946", step: "#528f5f", stepHover: "#535f54", pivot: "#1d1d1f", previewAdd: "#e246bf", previewRemove: "#5b7cff",
    };
    for (const k of Object.keys(want) as (keyof typeof PALETTE)[]) expect(hexOf(LIGHT_PALETTE[k]), k).toBe(want[k]);
    expect(paletteFor("light")).toBe(LIGHT_PALETTE);
    for (const back of lightBacks) {
      for (const k of Object.keys(want) as (keyof typeof PALETTE)[]) expect(contrastRatio(hexOf(LIGHT_PALETTE[k]), back), `${k} on ${back}`).toBeGreaterThanOrEqual(LIGHT_FLOORS.points);
      // the highlighted step is drawn at .95 and its hover preview at .7 (stepLayerStyle); the margin is thin by design, so re-measure before retuning
      expect(contrastRatio(blend(hexOf(LIGHT_PALETTE.step), 0.95, back), back), `step on ${back}`).toBeGreaterThanOrEqual(LIGHT_FLOORS.points);
      expect(contrastRatio(blend(hexOf(LIGHT_PALETTE.stepHover), 0.7, back), back), `stepHover on ${back}`).toBeGreaterThanOrEqual(LIGHT_FLOORS.points);
    }
    // the light Main layer chip colour is a ruled point colour too: pinned literally and held to the point floor on both backdrops
    expect(LIGHT_MAIN_COLOUR).toBe("#82888d");
    for (const back of lightBacks) expect(contrastRatio(LIGHT_MAIN_COLOUR, back), `main on ${back}`).toBeGreaterThanOrEqual(LIGHT_FLOORS.points);
    expect(rgbDistance(hexOf(LIGHT_PALETTE.protectedStrong), hexOf(LIGHT_PALETTE.protected))).toBeGreaterThanOrEqual(25);
  });

  test("UI-1103 the light presets: the ruled colours (the White slot is Blue, W1), ids and order kept, UI-721's distances on the light stage plus the point floor; dark unchanged", () => {
    expect(selectedPresets("dark")).toBe(SELECTED_COLOURS);
    const light = selectedPresets("light");
    expect(light.map((p) => p.id)).toEqual(SELECTED_COLOURS.map((p) => p.id));
    expect(light.map((p) => hexOf(p.colour))).toEqual(["#be7715", "#ed00ed", "#0000f0", "#239c0c"]);
    expect(light.map((p) => p.label)).toEqual(["Orange", "Magenta", "Blue", "Lime"]);
    expect(SELECTED_COLOURS.map((p) => p.label)).toEqual(["Orange", "Magenta", "White", "Lime"]);
    expect(light[0].colour).toEqual(LIGHT_PALETTE.selected);
    const P = LIGHT_PALETTE;
    const others = [P.base, P.protected, P.protectedStrong, P.slab, P.deleted, P.step, P.stepHover, P.previewAdd, P.previewRemove].map(hexOf);
    const stops = Object.values(RAMP_STOPS).flatMap((s) => s.map(hexOf));
    for (const p of light) {
      const c = hexOf(p.colour);
      for (const o of others) expect(rgbDistance(c, o), `${p.id} vs ${o}`).toBeGreaterThanOrEqual(60);
      for (const b of lightBacks) {
        expect(rgbDistance(c, b), `${p.id} vs ${b}`).toBeGreaterThanOrEqual(100);
        expect(contrastRatio(c, b), `${p.id} contrast on ${b}`).toBeGreaterThanOrEqual(LIGHT_FLOORS.points);
      }
      if (p.id !== "orange") for (const o of stops) expect(rgbDistance(c, o), `${p.id} vs ramp ${o}`).toBeGreaterThanOrEqual(80);
    }
    // no theme given = today's colours (UI-720)
    for (const p of SELECTED_COLOURS) expect(selectedRgb(p.id)).toEqual(p.colour);
    expect(selectedRgb("white", "light")).toEqual(light[2].colour);
    expect(selectedRgb("white", "dark")).toEqual(SELECTED_COLOURS[2].colour);
  });

  test("UI-1104 the light axes are the ruled colours: arrows 3:1 (light theme only), the dimmed rings 3:1, on both light backdrops; dark axes are AXIS_COLOUR itself", () => {
    expect(axisColours("dark")).toBe(AXIS_COLOUR);
    expect(axisColours("light")).toBe(LIGHT_AXIS_COLOUR);
    expect(LIGHT_AXIS_COLOUR).toEqual({ x: 0xe0352b, y: 0x1f9b3b, z: 0x1f6fe0 });
    for (const back of lightBacks) {
      for (const a of ["x", "y", "z"] as const) {
        expect(contrastRatio(num(LIGHT_AXIS_COLOUR[a]), back), `${a} arrow on ${back}`).toBeGreaterThanOrEqual(LIGHT_FLOORS.arrows);
        expect(contrastRatio(num(dim(LIGHT_AXIS_COLOUR[a], RING_TINT)), back), `${a} ring on ${back}`).toBeGreaterThanOrEqual(LIGHT_FLOORS.rings);
      }
    }
  });

  test("UI-1105 the light tool overlay colours read at 3:1 on both light backdrops; the live and draft outlines are 100 RGB apart; draftOutline follows renderTheme", () => {
    const tools = toolColours("light");
    const colours: Record<string, number> = { live: LIGHT_LIVE_OUTLINE, draft: LIGHT_DRAFT_OUTLINE, poly: tools.poly, handle: tools.handle, seed: tools.seed, plane: tools.plane };
    for (const back of lightBacks) for (const [k, v] of Object.entries(colours)) expect(contrastRatio(num(v), back), `${k} on ${back}`).toBeGreaterThanOrEqual(LIGHT_FLOORS.outlines);
    expect(rgbDistance(num(LIGHT_LIVE_OUTLINE), num(LIGHT_DRAFT_OUTLINE))).toBeGreaterThanOrEqual(100);
    const s = createAppStore().get();
    expect(draftOutline(s)).toEqual({ draft: false, colour: LIVE_OUTLINE });
    expect(draftOutline({ ...s, draft: true })).toEqual({ draft: true, colour: DRAFT_OUTLINE });
    expect(draftOutline({ ...s, renderTheme: "light" })).toEqual({ draft: false, colour: LIGHT_LIVE_OUTLINE });
    expect(draftOutline({ ...s, renderTheme: "light", draft: true })).toEqual({ draft: true, colour: LIGHT_DRAFT_OUTLINE });
    expect(toolColours("dark")).toEqual({ handle: 0xff9f1c, poly: 0x7be07b, plane: 0xc77dff, seed: 0xff4d6d });
  });

  test("UI-1106 renderTheme defaults to dark, is never saved, maps from the page's colour scheme, and a same-theme apply is a no-op", () => {
    const store = createAppStore();
    expect(store.get().renderTheme).toBe("dark");
    expect(JSON.stringify(serialiseClientState({ ...store.get(), renderTheme: "light" }))).not.toContain("renderTheme");
    expect(renderThemeOf(" light ")).toBe("light");
    expect(renderThemeOf("light")).toBe("light");
    for (const v of ["dark", "", "normal", "light dark", "LIGHT"]) expect(renderThemeOf(v), v).toBe("dark");
    let notified = 0;
    store.subscribe(() => notified++);
    const apply = applyRenderTheme(store);
    apply("light");
    expect(store.get().renderTheme).toBe("light");
    expect(notified).toBe(1);
    const after = store.get();
    apply("light");
    apply(" light ");
    expect(store.get()).toBe(after);
    expect(notified).toBe(1);
    apply("dark");
    expect(store.get().renderTheme).toBe("dark");
    expect(notified).toBe(2);
  });

  test("UI-1107 the colouriser paints the light palette when given it and today's colours when not; the colour cache key changes with the theme and with nothing else", () => {
    const coords = new Float32Array(18);
    coords[17] = 0.5; // the sixth point sits inside the region below
    const flags = new Uint8Array([1, 2, 8, 16, 0, 0]);
    const r = { coords, flags, count: 6, origin: [0, 0, 0] as [number, number, number] };
    const ctx = { mode: "flat" as const, bounds: null, markDeleted: false };
    const f32 = (c: readonly number[]) => c.map(Math.fround);
    const px = (a: Float32Array, i: number) => [...a.slice(i * 3, i * 3 + 3)];
    const P = LIGHT_PALETTE;
    const lit = colourizeMasked(r, { ...ctx, palette: P }).colours;
    expect([0, 1, 2, 3, 4].map((i) => px(lit, i))).toEqual([P.selected, P.protected, P.previewAdd, P.previewRemove, P.base].map(f32));
    const withRegion = colourizeMasked(r, { ...ctx, palette: P, region: { intervals: [{ min: 0.25, max: 1 }] } }).colours;
    expect(px(withRegion, 1)).toEqual(f32(P.protectedStrong));
    expect(px(withRegion, 5)).toEqual(f32(P.protectedStrong));
    expect(px(withRegion, 4)).toEqual(f32(P.base));
    // omitted palette = the dark one, byte for byte
    const dark = colourizeMasked(r, ctx).colours;
    expect([0, 1, 2, 3, 4].map((i) => px(dark, i))).toEqual([PALETTE.selected, PALETTE.protected, PALETTE.previewAdd, PALETTE.previewRemove, PALETTE.base].map(f32));
    expect(colourizeMasked(r, { ...ctx, palette: PALETTE }).colours).toEqual(dark);
    // the cache key: the theme is in it, nothing else moved
    const a = { ...createAppStore().get(), session: sessionFixture() };
    expect(layerColourKey({ ...a, renderTheme: "light" }, false)).not.toBe(layerColourKey({ ...a, renderTheme: "dark" }, false));
    expect(layerColourKey({ ...a, renderTheme: "light" }, true)).toBe(layerColourKey({ ...a, renderTheme: "light" }, true));
    expect(layerColourKey({ ...a, renderTheme: "dark" }, false)).toBe(layerColourKey(a, false));
  });

  test("UI-1108 the step style, the overlay style and the legend entries take the theme; with no theme they equal today's output", () => {
    const t = { ...emptyTimeline(), highlight: 3 };
    expect(stepLayerStyle(t)).toEqual({ sid: 3, colour: PALETTE.step, opacity: 0.95, sizeDelta: 2, hover: false });
    expect(stepLayerStyle(t, "dark")).toEqual(stepLayerStyle(t));
    expect(stepLayerStyle(t, "light")).toEqual({ sid: 3, colour: LIGHT_PALETTE.step, opacity: 0.95, sizeDelta: 2, hover: false });
    const hover = { ...t, hover: 4 };
    expect(stepLayerStyle(hover)).toEqual({ sid: 4, colour: PALETTE.stepHover, opacity: 0.7, sizeDelta: 2, hover: true });
    expect(stepLayerStyle(hover, "light")).toEqual({ sid: 4, colour: LIGHT_PALETTE.stepHover, opacity: 0.7, sizeDelta: 2, hover: true });
    expect(stepLayerStyle(emptyTimeline(), "light")).toBeNull();
    expect(overlayStyle(0.5)).toEqual({ colour: PALETTE.deleted, opacity: 0.5 });
    expect(overlayStyle(0.5, "dark")).toEqual(overlayStyle(0.5));
    expect(overlayStyle(0.5, "light")).toEqual({ colour: LIGHT_PALETTE.deleted, opacity: 0.5 });
    const dark = legendEntries(true, "add", undefined, []);
    expect(dark.find((e) => e.id === "base")?.colour).toEqual(PALETTE.base);
    expect(legendEntries(true, "add", undefined, [], PALETTE)).toEqual(dark);
    const light = legendEntries(true, "add", undefined, [], LIGHT_PALETTE);
    expect(light.map((e) => e.id)).toEqual(dark.map((e) => e.id));
    const want: Record<string, readonly number[]> = { base: LIGHT_PALETTE.base, selected: LIGHT_PALETTE.selected, protected: LIGHT_PALETTE.protected, slab: LIGHT_PALETTE.slab, deleted: LIGHT_PALETTE.deleted, "preview-add": LIGHT_PALETTE.previewAdd, step: LIGHT_PALETTE.step };
    for (const [id, c] of Object.entries(want)) expect(light.find((e) => e.id === id)?.colour, id).toEqual(c);
    // a chosen Selected colour still wins over the palette's candidate colour
    expect(legendEntries(false, null, [0, 0, 1], [], LIGHT_PALETTE).find((e) => e.id === "selected")?.colour).toEqual([0, 0, 1]);
  });

  test("UI-1112 the colours handed to three.js: the dark palette is passed through untouched, the light one is converted from sRGB to linear so the drawn pixel is the hex", () => {
    // dark: the same object, so every dark value is byte-identical to today's
    expect(gpuPalette("dark")).toBe(DP);
    expect(gpuRgb(DP.base, "dark")).toBe(DP.base);
    const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    expect(gpuRgb([0, 1, 0.5], "light")).toEqual([0, 1, lin(0.5)]);
    const g = gpuPalette("light");
    expect(Object.keys(g)).toEqual(Object.keys(LP));
    for (const k of Object.keys(LP) as (keyof typeof LP)[]) expect([...g[k]], k).toEqual(LP[k].map(lin));
    // three.js sRGB-encodes the linear value on output: 0x87 comes back as 0x87 (135), not 192
    const enc = (c: number) => Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055));
    expect(g.base.map(enc)).toEqual([135, 135, 135]);
    // the legend palette itself stays the sRGB hex
    expect(LP.base.map((c) => Math.round(c * 255))).toEqual([135, 135, 135]);
  });
});
