import { describe, expect, test } from "vitest";
import { MAIN_COLOUR } from "../layers/model";
import { PALETTE, contrastRatio } from "../colour/palette";
import { AXIS_COLOUR as PLANE_AXIS } from "../filterboxes/plane";
import { bandOverlaySpec } from "../inspector/bandgizmo";
import { createAppStore, type AppState } from "../state/app";
import type { Vec3 } from "../state/types";
import { BACKDROPS, INDEX_HTML, SURFACES, blockAfter, declsOf, HEADS, onSurface, parseBlocks, parseColour, raw, solid, surface, type Theme } from "../testing/tokens";
import { sessionFixture } from "../testing/fixtures";
import { boxOverlaySpec } from "../tools/box/overlay";
import { type BoxModel, defaultBox, rpyToQuat } from "../tools/box/model";
import { AXIS_COLOUR as TRIAD_AXIS } from "./triad";
import { defaultCamera } from "../view/camera";
import { applyPreset } from "../view/presets";

const THEMES: readonly Theme[] = ["dark", "light"];
describe("design tokens (part 22-4)", () => {
  test("UI-1080 exactly three token blocks exist and agree; no other selector re-declares a semantic token", () => {
    const blocks = parseBlocks();
    expect(blocks.colorScheme).toEqual({ root: "dark", media: "light", attr: "light" });
    expect(blocks.media).toEqual(blocks.attr);
    const names = Object.keys(blocks.media);
    expect(names.length).toBeGreaterThan(20);
    for (const n of names) expect(blocks.root[n], `--${n} is also mapped in the dark :root`).toBeDefined();
    // the light mappings sit inside the prefers-color-scheme media query
    expect(INDEX_HTML).toMatch(/@media \(prefers-color-scheme: light\)\s*\{\s*:root:not\(\[data-theme="dark"\]\)/);
    // cut the three blocks out; whatever declares a custom property is left over
    let rest = INDEX_HTML;
    for (const head of [HEADS.root, HEADS.media, HEADS.attr]) rest = rest.replace(blockAfter(rest, head), "");
    const left = Object.keys(declsOf(rest));
    for (const n of names) expect(left, `--${n} must be declared only in the token blocks (no #stage block)`).not.toContain(n);
    expect(rest).not.toMatch(/#stage\s*\{[^}]*--[a-z]/);
  });

  const EXPECT: Record<Theme, Record<string, string>> = {
    dark: {
      canvas: "#0c0d10", "canvas-vignette": "#16181d",
      glass: "rgba(30,31,36,.70)", "glass-hud": "rgba(24,25,30,.62)", "glass-strong": "rgba(36,37,43,.86)",
      "glass-edge": "rgba(255,255,255,.09)", separator: "rgba(255,255,255,.08)",
      "fill-1": "rgba(255,255,255,.06)", "fill-2": "rgba(255,255,255,.10)", "fill-3": "rgba(255,255,255,.16)", field: "rgba(0,0,0,.28)",
      shadow: "0 12px 40px rgba(0,0,0,.45), 0 1px 0 rgba(255,255,255,.04) inset", "shadow-pop": "0 18px 60px rgba(0,0,0,.55)",
      label: "#f5f5f7", "label-2": "rgba(235,235,245,.72)", "label-3": "rgba(235,235,245,.55)",
      accent: "#0a84ff", "accent-soft": "rgba(10,132,255,.20)", "accent-text": "#409cff", "on-accent": "#0c0d10", "on-destructive": "#0c0d10", focus: "#0a84ff",
      destructive: "#ff453a", "destructive-soft": "rgba(255,69,58,.16)", "destructive-text": "#ff453a",
      success: "#30d158", warning: "#ffd60a", "protected-ui": "#00d1ff",
    },
    light: {
      canvas: "#e9ebef", "canvas-vignette": "#f6f7f9",
      glass: "rgba(248,248,250,.74)", "glass-hud": "rgba(250,250,252,.70)", "glass-strong": "rgba(252,252,253,.92)",
      "glass-edge": "rgba(0,0,0,.08)", separator: "rgba(0,0,0,.08)",
      "fill-1": "rgba(0,0,0,.045)", "fill-2": "rgba(0,0,0,.075)", "fill-3": "rgba(0,0,0,.12)", field: "rgba(255,255,255,.9)",
      shadow: "0 10px 34px rgba(30,35,50,.16), 0 1px 0 rgba(255,255,255,.7) inset", "shadow-pop": "0 16px 50px rgba(30,35,50,.22)",
      label: "#1d1d1f", "label-2": "rgba(60,60,67,.84)", "label-3": "rgba(60,60,67,.72)",
      accent: "#007aff", "accent-soft": "rgba(0,122,255,.14)", "accent-text": "#0066d6", "on-accent": "#0c0d10", "on-destructive": "#0c0d10", focus: "#007aff",
      destructive: "#ff3b30", "destructive-soft": "rgba(255,59,48,.12)", "destructive-text": "#d70015",
      success: "#248a3d", warning: "#9a7300", "protected-ui": "#00789c",
    },
  };
  // Measured departures from mockup notes.md (plan E3): accent-text, on-accent, on-destructive, destructive-text, protected-ui are new;
  // focus is the opaque accent (the mockup's 55% ring measured 2.18 / 1.79); the light warning is #9a7300 (the mockup's #b58900 measured 2.94).
  // The light --pt-protected and the light axes are deferred to 22-4b and are deliberately absent (UI-1084).
  const norm = (v: string): string => v.replace(/\s+/g, "").replace(/\d*\.?\d+/g, (n) => String(Number(n))).toLowerCase();

  test("UI-1081 token values equal notes.md in both themes, with the measured departures listed above", () => {
    const blocks = parseBlocks();
    for (const theme of THEMES) {
      for (const [name, want] of Object.entries(EXPECT[theme])) expect(norm(raw(theme, name, blocks)), `${theme} --${name}`).toBe(norm(want));
    }
  });

  test("UI-1082 every text token reads at 4.5:1 on every surface over its own theme's backdrop; label and label-2 also straight on the stage", () => {
    const blocks = parseBlocks();
    for (const theme of THEMES) {
      for (const over of BACKDROPS) {
        for (const s of SURFACES) {
          for (const t of ["label", "label-2", "label-3", "accent-text", "destructive-text", "protected-ui"]) {
            expect(contrastRatio(onSurface(theme, t, s, over, blocks), surface(theme, s, over, blocks)), `${theme} ${t} on ${s} over ${over}`).toBeGreaterThanOrEqual(4.5);
          }
        }
        for (const t of ["label", "label-2"]) {
          expect(contrastRatio(solid(theme, t, solid(theme, over, undefined, blocks), blocks), solid(theme, over, undefined, blocks)), `${theme} ${t} on the ${over}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  test("UI-1083 non-text colours read at 3:1 on every surface; the labels on the accent and destructive fills and on the pressed fill read at 4.5:1", () => {
    const blocks = parseBlocks();
    for (const theme of THEMES) {
      for (const over of BACKDROPS) {
        for (const s of SURFACES) {
          const bg = surface(theme, s, over, blocks);
          for (const t of ["accent", "destructive", "success", "warning", "focus", "protected-ui"]) {
            expect(contrastRatio(onSurface(theme, t, s, over, blocks), bg), `${theme} ${t} on ${s} over ${over}`).toBeGreaterThanOrEqual(3);
          }
          const pressed = solid(theme, "accent-soft", bg, blocks);
          expect(contrastRatio(solid(theme, "label", pressed, blocks), pressed), `${theme} label on the pressed fill on ${s} over ${over}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      expect(contrastRatio(solid(theme, "on-accent"), solid(theme, "accent")), `${theme} on-accent`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(solid(theme, "on-destructive"), solid(theme, "destructive")), `${theme} on-destructive`).toBeGreaterThanOrEqual(4.5);
    }
  });

  const hexOf = (c: readonly [number, number, number]): string => `#${c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
  const num = (n: number): string => `#${n.toString(16).padStart(6, "0")}`;

  test("UI-1084 data and axis tokens live only in the dark :root and equal the render palette; neither light block declares one; the stage tokens are per theme", () => {
    const blocks = parseBlocks();
    const want: Record<string, string> = {
      "pt-candidate": hexOf(PALETTE.selected), "pt-protected": hexOf(PALETTE.protected), "pt-slab": hexOf(PALETTE.slab), "pt-deleted": hexOf(PALETTE.deleted),
      "pt-step": hexOf(PALETTE.step), "pt-add": hexOf(PALETTE.previewAdd), "pt-remove": hexOf(PALETTE.previewRemove), "pt-main": MAIN_COLOUR,
      "ax-x": num(PLANE_AXIS.x), "ax-y": num(PLANE_AXIS.y), "ax-z": num(PLANE_AXIS.z),
    };
    for (const [name, hex] of Object.entries(want)) expect(parseColour(blocks.root[name] ?? "").hex, `--${name}`).toBe(hex);
    expect([TRIAD_AXIS.x, TRIAD_AXIS.y, TRIAD_AXIS.z]).toEqual([blocks.root["ax-x"], blocks.root["ax-y"], blocks.root["ax-z"]]);
    for (const block of [blocks.media, blocks.attr]) expect(Object.keys(block).filter((n) => /^(pt|ax)-/.test(n))).toEqual([]);
    expect(solid("dark", "canvas")).toBe("#0c0d10");
    expect(solid("dark", "canvas-vignette")).toBe("#16181d");
    expect(solid("light", "canvas")).toBe("#e9ebef");
    expect(solid("light", "canvas-vignette")).toBe("#f6f7f9");
  });

  test("UI-1085 the Box and band arrows read at 4.5:1 and the rings at 3:1 against the dark theme's canvas and vignette", () => {
    const blocks = parseBlocks();
    const cam = applyPreset({ ...defaultCamera(), distance: 10 }, "top");
    const box: BoxModel = { ...defaultBox([1, 2, 3]), dimensions: [2, 3, 4], quat: rpyToQuat([10, 20, 30]) };
    const store = createAppStore();
    store.set({ session: sessionFixture(), camera: { ...defaultCamera(), distance: 30, target: [5, 5, 5] as Vec3 } });
    store.update((s: AppState) => ({
      ...s,
      floorPanelOpen: true,
      tools: { ...s.tools, protection: { ...s.tools.protection, global: { enabled: true, min: 2, max: 4 }, tilt: { rx: 20, ry: 30, pivot: [5, 5] as [number, number] } } },
    }));
    const specs = [boxOverlaySpec(box, cam, null, 720), boxOverlaySpec(box, cam, "rotate-0+", 720), bandOverlaySpec(store.get(), 600)];
    let arrows = 0;
    let rings = 0;
    for (const spec of specs) {
      for (const back of BACKDROPS.map((b) => solid("dark", b))) {
        for (const a of spec.arrows) { arrows++; expect(contrastRatio(num(a.colour), back), a.id).toBeGreaterThanOrEqual(4.5); }
        for (const r of spec.rings) { rings++; expect(contrastRatio(num(r.colour), back), r.id).toBeGreaterThanOrEqual(3); }
      }
    }
    expect(arrows).toBeGreaterThan(10);
    expect(rings).toBeGreaterThan(10);
  });
});
