import { describe, expect, test } from "vitest";
import { LIGHT_MAIN_COLOUR, MAIN_COLOUR } from "../layers/model";
import { LIGHT_PALETTE, PALETTE, contrastRatio } from "../colour/palette";
import { AXIS_COLOUR as PLANE_AXIS, LIGHT_AXIS_COLOUR as LIGHT_AXIS, axisColours } from "../filterboxes/plane";
import { bandOverlaySpec } from "../inspector/bandgizmo";
import { createAppStore, type AppState } from "../state/app";
import type { Vec3 } from "../state/types";
import { BACKDROPS, INDEX_HTML, SURFACES, blockAfter, declsOf, HEADS, onSurface, parseBlocks, parseColour, raw, solid, surface, type Theme } from "../testing/tokens";
import { sessionFixture } from "../testing/fixtures";
import { LIGHT_FLOORS } from "../testing/floors";
import { timelineCss } from "../timeline/overlay";
import { cubeNavCss } from "./cube-arrows";
import { RING_TINT, boxOverlaySpec, dim } from "../tools/box/overlay";
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
  // The light data and axis tokens (R22-13, R22-14) are the light render palette: --pt-protected is #0092be (notes.md #0099c7 measured 2.76 on #e9ebef)
  // and --ax-y is #1f9b3b (notes.md #1f9e3c measured 2.93); --ax-x and --ax-z are notes.md's own.
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

  test("UI-1084 data and axis tokens: the dark :root equals the dark render palette and both light blocks declare the same names equal to the light render palette (R22-13, R22-14); the stage tokens are per theme", () => {
    const blocks = parseBlocks();
    const wantFor = (pal: typeof PALETTE, main: string, axes: Record<"x" | "y" | "z", number>): Record<string, string> => ({
      "pt-candidate": hexOf(pal.selected), "pt-protected": hexOf(pal.protected), "pt-slab": hexOf(pal.slab), "pt-deleted": hexOf(pal.deleted),
      "pt-step": hexOf(pal.step), "pt-add": hexOf(pal.previewAdd), "pt-remove": hexOf(pal.previewRemove), "pt-main": main,
      "ax-x": num(axes.x), "ax-y": num(axes.y), "ax-z": num(axes.z),
    });
    const dark = wantFor(PALETTE, MAIN_COLOUR, PLANE_AXIS);
    for (const [name, hex] of Object.entries(dark)) expect(parseColour(blocks.root[name] ?? "").hex, `--${name}`).toBe(hex);
    expect([TRIAD_AXIS.x, TRIAD_AXIS.y, TRIAD_AXIS.z]).toEqual([blocks.root["ax-x"], blocks.root["ax-y"], blocks.root["ax-z"]]);
    const light = wantFor(LIGHT_PALETTE, LIGHT_MAIN_COLOUR, LIGHT_AXIS);
    const names = Object.keys(blocks.root).filter((n) => /^(pt|ax)-/.test(n));
    expect(names.sort()).toEqual(Object.keys(dark).sort());
    for (const [label, block] of [["media", blocks.media], ["attr", blocks.attr]] as const) {
      expect(Object.keys(block).filter((n) => /^(pt|ax)-/.test(n)).sort(), `${label} block declares every pt-/ax- name`).toEqual(names);
      for (const [name, hex] of Object.entries(light)) expect(parseColour(block[name] ?? "").hex, `${label} --${name}`).toBe(hex);
    }
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

  test("UI-1110 the Box and band specs in the light theme read at the light floors (arrows 3:1, rings 3:1) on both light backdrops; the dark specs equal the no-argument ones", () => {
    const cam = applyPreset({ ...defaultCamera(), distance: 10 }, "top");
    const box: BoxModel = { ...defaultBox([1, 2, 3]), dimensions: [2, 3, 4], quat: rpyToQuat([10, 20, 30]) };
    const store = createAppStore();
    store.set({ session: sessionFixture(), camera: { ...defaultCamera(), distance: 30, target: [5, 5, 5] as Vec3 } });
    store.update((s: AppState) => ({
      ...s,
      floorPanelOpen: true,
      tools: { ...s.tools, protection: { ...s.tools.protection, global: { enabled: true, min: 2, max: 4 }, tilt: { rx: 20, ry: 30, pivot: [5, 5] as [number, number] } } },
    }));
    const lightAxes = axisColours("light");
    const lightState = { ...store.get(), renderTheme: "light" as const };
    const band = bandOverlaySpec(lightState, 600);
    const specs = [boxOverlaySpec(box, cam, null, 720, lightAxes), boxOverlaySpec(box, cam, "rotate-0+", 720, lightAxes), band];
    const lightColours = new Set(Object.values(lightAxes));
    const ringColours = new Set(Object.values(lightAxes).map((c) => dim(c, RING_TINT)));
    let arrows = 0;
    let rings = 0;
    for (const spec of specs) {
      for (const back of BACKDROPS.map((b) => solid("light", b))) {
        for (const a of spec.arrows) { arrows++; expect(lightColours.has(a.colour), a.id).toBe(true); expect(contrastRatio(num(a.colour), back), a.id).toBeGreaterThanOrEqual(LIGHT_FLOORS.arrows); }
        for (const r of spec.rings) { rings++; expect(lightColours.has(r.colour) || ringColours.has(r.colour), r.id).toBe(true); expect(contrastRatio(num(r.colour), back), r.id).toBeGreaterThanOrEqual(LIGHT_FLOORS.rings); }
      }
    }
    for (const sh of band.shafts) { expect(lightColours.has(sh.colour), sh.id).toBe(true); expect(contrastRatio(num(sh.colour), solid("light", "canvas")), sh.id).toBeGreaterThanOrEqual(LIGHT_FLOORS.arrows); }
    expect(arrows).toBeGreaterThan(10);
    expect(rings).toBeGreaterThan(10);
    expect(band.shafts.length).toBeGreaterThan(0);
    // dark: passing the dark axes, or nothing, or a dark store, changes nothing
    expect(boxOverlaySpec(box, cam, null, 720, PLANE_AXIS)).toEqual(boxOverlaySpec(box, cam, null, 720));
    expect(boxOverlaySpec(box, cam, "rotate-0+", 720, axisColours("dark"))).toEqual(boxOverlaySpec(box, cam, "rotate-0+", 720));
    const dark = bandOverlaySpec(store.get(), 600);
    expect(bandOverlaySpec({ ...store.get(), renderTheme: "dark" }, 600)).toEqual(dark);
    for (const a of dark.arrows) expect(Object.values(PLANE_AXIS)).toContain(a.colour);
    for (const sh of dark.shafts) expect(Object.values(PLANE_AXIS)).toContain(sh.colour);
  });
});

/** index.html's <style> text with the comments cut out. */
const styleText = (): string => (INDEX_HTML.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
interface Rule {
  selector: string;
  body: string;
}
/** Every `selector { body }` pair, at-rules flattened (their preludes are dropped). */
const rules = (css: string): Rule[] => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));

describe("stylesheet rules (part 22-4)", () => {
  test("UI-1086 no colour literal outside the token blocks except the allow-list, and no var() that is never declared", () => {
    const blocks = parseBlocks();
    let rest = styleText();
    for (const head of [HEADS.root, HEADS.media, HEADS.attr]) rest = rest.replace(blockAfter(rest, head), "");
    const allowed: RegExp[] = [/dialog::backdrop/, /\.cube-face\b/, /\.ramp-bar\b/];
    const literal = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/;
    const offenders = rules(rest)
      .filter((r) => literal.test(r.body) && !allowed.some((a) => a.test(r.selector)))
      .map((r) => `${r.selector} { ${r.body.trim()} }`);
    expect(offenders).toEqual([]);
    const declared = new Set([...Object.keys(blocks.root), ...Object.keys(blocks.media), ...Object.keys(declsOf(styleText()))]);
    const sources: Record<string, string> = { "index.html": styleText(), timelineCss: timelineCss(), cubeNavCss: cubeNavCss() };
    for (const [file, text] of Object.entries(sources)) {
      for (const m of text.matchAll(/var\(--([a-z0-9-]+)/g)) expect(declared.has(m[1]), `${file} uses var(--${m[1]}), which no block declares`).toBe(true);
      // a literal fallback inside var() would hide a missing token
      expect(text, file).not.toMatch(/var\(--[a-z0-9-]+\s*,\s*#/);
    }
  });

  test("UI-1101 #webgl-notice declares no border (part 4 adds none), and draws its edge as an inset box-shadow in --destructive", () => {
    const body = rules(styleText()).find((r) => r.selector === "#webgl-notice")?.body ?? "";
    expect(body, "#webgl-notice rule").not.toBe("");
    expect(body).not.toMatch(/(^|[\s;])border(-width|-top|-right|-bottom|-left)?\s*:/);
    const shadow = body.match(/box-shadow:\s*([^;]+);/)?.[1] ?? "";
    expect(shadow).toContain("inset");
    expect(shadow).toContain("var(--destructive)");
  });

  test("UI-1087 one :focus-visible rule draws a 3px --focus outline; nothing else draws an outline except the locked-chip marker, and none sets outline none", () => {
    const all = rules(styleText());
    const focus = all.filter((r) => /:focus-visible/.test(r.selector));
    expect(focus.map((r) => r.selector)).toEqual([":focus-visible"]);
    expect(focus[0].body).toMatch(/outline:\s*3px solid var\(--focus\)/);
    const others = all.filter((r) => !/:focus-visible/.test(r.selector) && /(^|[;\s])outline(-style|-width)?\s*:/.test(r.body));
    expect(others.map((r) => r.selector)).toEqual([".layer-row .chip.locked"]);
    expect(others[0].body).toMatch(/1px dashed var\(--label\)/);
    for (const r of all) expect(r.body, r.selector).not.toMatch(/outline(-style)?\s*:\s*(none|0)\b/);
  });

  test("UI-1088 every transition lasts 120-250 ms and the reduced-motion block turns transitions and animations off for everything", () => {
    const css = styleText();
    const root = parseBlocks().root;
    let n = 0;
    for (const m of css.matchAll(/transition\s*:\s*([^;}]+)/g)) {
      if (/^\s*none\b/.test(m[1])) continue; // the reduced-motion switch-off
      const value = m[1].replace(/var\(--([a-z0-9-]+)\)/g, (_, name: string) => root[name] ?? "NaN");
      const times = [...value.matchAll(/(\d*\.?\d+)(ms|s)\b/g)].map((t) => (t[2] === "s" ? Number(t[1]) * 1000 : Number(t[1])));
      expect(times.length, m[0]).toBeGreaterThan(0);
      for (const t of times) {
        expect(t, m[0]).toBeGreaterThanOrEqual(120);
        expect(t, m[0]).toBeLessThanOrEqual(250);
      }
      n++;
    }
    expect(n).toBeGreaterThan(1);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\*, \*::before, \*::after\s*\{[^}]*transition:\s*none[^}]*animation:\s*none/);
  });

  test("UI-1089 the font stack, the type tokens and tabular numerals on the count selectors; no remote font", () => {
    const { root } = parseBlocks();
    expect(root.font).toBe('-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif');
    expect(root["t-title"]).toBe("600 15px/20px var(--font)");
    expect(root["t-headline"]).toBe("600 13px/18px var(--font)");
    expect(root["t-body"]).toBe("400 13px/18px var(--font)");
    expect(root["t-callout"]).toBe("400 12px/16px var(--font)");
    expect(root["t-caption"]).toBe("500 11px/14px var(--font)");
    expect(root["t-section"]).toBe("600 11px/14px var(--font)");
    expect(root["t-sheet"]).toBe("700 17px/22px var(--font)");
    expect(INDEX_HTML).not.toMatch(/@import|@font-face|https?:\/\/|<link[^>]+stylesheet/);
    const all = rules(styleText());
    const tabular = all.filter((r) => /font-variant-numeric:\s*tabular-nums/.test(r.body)).map((r) => r.selector).join(", ");
    for (const sel of ["#statusbar .item", ".layer-count", "#apply", "#kept-chip", ".step-count", ".triple input", ".fbox .fin", ".fbox .ftog"]) expect(tabular, sel).toContain(sel);
    const h2 = all.find((r) => r.selector === "aside h2")!;
    expect(h2.body).toMatch(/font:\s*var\(--t-section\)/);
    expect(h2.body).not.toMatch(/uppercase|letter-spacing/);
    expect(all.find((r) => r.selector === "body")!.body).toMatch(/font:\s*var\(--t-body\)/);
  });

  test("UI-1143 (popover glass) .pop is fixed, rounded, shadowed and above the stage HUD, blurs like the sheets with the opaque fallback, and has no display of its own when shown", () => {
    const css = styleText();
    const all = rules(css);
    const has = (sel: string) => all.filter((r) => r.selector.split(",").map((x) => x.trim()).includes(sel));
    const pop = has(".pop").map((r) => r.body).join(";");
    expect(pop).toMatch(/position:\s*fixed/);
    expect(pop).toContain("border-radius: var(--r-pop)");
    expect(pop).toContain("box-shadow: var(--shadow-pop)");
    expect(pop).not.toMatch(/(^|[;\s])display:/);
    expect(has(".pop[hidden]").map((r) => r.body).join(";")).toContain("display: none");
    const z = (b: string) => Number(b.match(/z-index:\s*(\d+)/)?.[1] ?? 0);
    const hud = all.filter((r) => /#(legend|fbox-layer|camera-cluster|triad|band-pill|notices|progress|help-overlay)\b|\.fbox/.test(r.selector)).map((r) => z(r.body));
    expect(z(pop)).toBeGreaterThan(Math.max(...hud));
    expect(has(".pop").some((r) => /backdrop-filter: blur\(28px\) saturate\(170%\)/.test(r.body))).toBe(true);
    const supports = css.match(/@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\)\s*\{([\s\S]*?\})\s*\}/);
    const fb = rules(supports![1] + "}").find((r) => r.selector.split(",").map((x) => x.trim()).includes(".pop"));
    expect(fb?.body).toContain("background: var(--glass-strong-solid)");
  });

  test("UI-1090 the stage glass and the sheets carry blur(28px) saturate(170%) with the -webkit- twin, the page glass carries none, #viewport never blurs, and @supports not swaps in the opaque composites", () => {
    const css = styleText();
    const all = rules(css);
    const filter = "blur(28px) saturate(170%)";
    const blurred = all.filter((r) => /backdrop-filter/.test(r.body));
    for (const r of blurred) {
      expect(r.body, r.selector).toContain(`backdrop-filter: ${filter}`);
      expect(r.body, r.selector).toContain(`-webkit-backdrop-filter: ${filter}`);
      expect(r.selector, "no blur on the canvas").not.toMatch(/#viewport|canvas/);
    }
    const inside = (selector: string) => blurred.filter((r) => r.selector.split(",").map((x) => x.trim()).includes(selector));
    const hud = ["#legend", ".fbox", "#camera-cluster .ib", "#band-pill", ".notice"];
    const strong = ["dialog", "#help-overlay", "#progress"];
    for (const sel of [...hud, ...strong]) expect(inside(sel).length, sel).toBeGreaterThan(0);
    for (const sel of ["aside", ".row", "#statusbar"]) expect(inside(sel), sel).toEqual([]);
    const supports = css.match(/@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\)\s*\{([\s\S]*?\})\s*\}/);
    expect(supports, "@supports not block").not.toBeNull();
    const fallback = rules(supports![1] + "}");
    const bgOf = (sel: string) => fallback.find((r) => r.selector.split(",").map((x) => x.trim()).includes(sel))?.body ?? "";
    for (const sel of hud) expect(bgOf(sel), sel).toContain("background: var(--glass-hud-solid)");
    for (const sel of strong) expect(bgOf(sel), sel).toContain("background: var(--glass-strong-solid)");
    for (const sel of ["aside", ".row", "#statusbar"]) expect(bgOf(sel), sel).toContain("background: var(--glass-solid)");
    // the opaque composites are what the translucent glass reads over the theme's stage, so the fallback keeps the contrast
    for (const theme of ["dark", "light"] as const) {
      for (const [glass, solidName] of [["glass", "glass-solid"], ["glass-hud", "glass-hud-solid"], ["glass-strong", "glass-strong-solid"]] as const) {
        const want = surface(theme, glass, "canvas");
        const got = solid(theme, solidName);
        for (let i = 1; i <= 5; i += 2) expect(Math.abs(parseInt(got.slice(i, i + 2), 16) - parseInt(want.slice(i, i + 2), 16)), `${theme} ${solidName}`).toBeLessThanOrEqual(6);
      }
    }
  });
});
