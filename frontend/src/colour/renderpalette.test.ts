import { describe, expect, test } from "vitest";
import { createAppStore } from "../state/app";
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
});
