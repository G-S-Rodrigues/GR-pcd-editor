// Test-only reader of the design tokens in index.html (part 22-4). Nothing in the app imports this file.
import indexHtml from "../../index.html?raw";
import { blend } from "../timeline/overlay";

export type Theme = "dark" | "light";
export type Decls = Record<string, string>;
export interface Blocks {
  /** The dark `:root`: primitives, the dark mappings and every theme-independent token. */
  root: Decls;
  /** `@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) { ... } }` */
  media: Decls;
  /** `:root[data-theme="light"] { ... }` */
  attr: Decls;
  colorScheme: { root: string; media: string; attr: string };
}

export const INDEX_HTML: string = indexHtml;

/** The text between the braces that follow the first match of `head` (braces nest). */
export function blockAfter(src: string, head: RegExp): string {
  const m = head.exec(src);
  if (!m) throw new Error(`token block ${head} missing from index.html`);
  let i = src.indexOf("{", m.index + m[0].length - 1);
  const start = i + 1;
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i);
  }
  throw new Error(`token block ${head} is not closed`);
}

export function declsOf(body: string): Decls {
  const out: Decls = {};
  for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim().replace(/\s+/g, " ");
  return out;
}

const scheme = (body: string): string => body.match(/color-scheme:\s*(\w+)/)?.[1] ?? "";

export const HEADS = {
  root: /(^|[\s}]):root\s*\{/,
  media: /:root:not\(\[data-theme="dark"\]\)\s*\{/,
  attr: /:root\[data-theme="light"\]\s*\{/,
};

export function parseBlocks(html: string = indexHtml): Blocks {
  const bodies = { root: blockAfter(html, HEADS.root), media: blockAfter(html, HEADS.media), attr: blockAfter(html, HEADS.attr) };
  return {
    root: declsOf(bodies.root),
    media: declsOf(bodies.media),
    attr: declsOf(bodies.attr),
    colorScheme: { root: scheme(bodies.root), media: scheme(bodies.media), attr: scheme(bodies.attr) },
  };
}

/** The raw value of a token in a theme (the light block overrides the root), `var()` followed, as written. */
export function raw(theme: Theme, name: string, blocks: Blocks = parseBlocks(), depth = 0): string {
  if (depth > 6) throw new Error(`token --${name}: var() chain too deep`);
  const table = theme === "light" ? { ...blocks.root, ...blocks.media } : blocks.root;
  const v = table[name];
  if (v === undefined) throw new Error(`token --${name} missing`);
  const ref = v.match(/^var\(--([a-z0-9-]+)\)$/);
  return ref ? raw(theme, ref[1], blocks, depth + 1) : v;
}

export interface Colour {
  hex: string;
  alpha: number;
}

export function parseColour(value: string): Colour {
  const h = value.match(/^#([0-9a-fA-F]{6})$/);
  if (h) return { hex: `#${h[1].toLowerCase()}`, alpha: 1 };
  const m = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (!m) throw new Error(`not a colour: ${value}`);
  const hex = `#${[m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, "0")).join("")}`;
  return { hex, alpha: m[4] === undefined ? 1 : Number(m[4]) };
}

/** A token as #rrggbb; a translucent one is composited over `over` (it throws if there is none). */
export function solid(theme: Theme, name: string, over?: string, blocks?: Blocks): string {
  const c = parseColour(raw(theme, name, blocks));
  if (c.alpha >= 1) return c.hex;
  if (!over) throw new Error(`token --${name} is translucent: give the colour it sits on`);
  return blend(c.hex, c.alpha, over);
}

export type Backdrop = "canvas" | "canvas-vignette";
export const BACKDROPS: readonly Backdrop[] = ["canvas", "canvas-vignette"];
export const SURFACES = ["glass", "glass-hud", "glass-strong"] as const;

/** A glass token composited over its own theme's stage backdrop. */
export function surface(theme: Theme, name: (typeof SURFACES)[number], over: Backdrop, blocks?: Blocks): string {
  return solid(theme, name, solid(theme, over, undefined, blocks), blocks);
}

/** `name` drawn on the glass `surfaceName`, itself over `over`. */
export function onSurface(theme: Theme, name: string, surfaceName: (typeof SURFACES)[number], over: Backdrop, blocks?: Blocks): string {
  return solid(theme, name, surface(theme, surfaceName, over, blocks), blocks);
}
