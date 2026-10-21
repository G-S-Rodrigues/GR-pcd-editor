import { CUBE_NAV, CUBE_RIGHT, CUBE_SIDE, CUBE_STAGE, CUBE_WRAP, CUBE_WRAP_TOP } from "../view/layout";
import type { IconName } from "./icons";

/**
 * EVERYTHING about how the ViewCube arrows and corner zones look lives here, in one place to tweak:
 * the glyph (any name from ui/icons.ts, drawn pointing up and rotated outward), sizes, colours and the resting and
 * hover opacities. Positions come from view/cubenav.ts and the pixel sizes from view/layout.ts (CUBE_NAV).
 */
export const ARROW_STYLE = {
  /** Glyph drawn in each arrow button; it must point up in its own 24 grid (the code rotates it outward). */
  icon: "arrow" as IconName,
  glyphSize: 16,
  /** Translucent grey button behind the glyph, and the glyph colour. */
  fill: "#3c4450",
  hoverFill: "#56606e",
  glyph: "#f1f4f8",
  /** Corner zones: a small dot-like disc. */
  zoneFill: "#3c4450",
  zoneHoverFill: "#56606e",
  /** Almost invisible at rest, clearly visible while the pointer or keyboard focus is on the cube. */
  restOpacity: 0.12,
  hoverOpacity: 0.95,
  transitionSeconds: 0.15,
} as const;

export const STYLE_ID = "cube-nav-style";

/** The stylesheet text for the wrapper, arrows and zones (also read by the tests). */
export function cubeNavCss(): string {
  const a = ARROW_STYLE;
  const offset = (CUBE_WRAP - CUBE_STAGE) / 2;
  const face = (CUBE_STAGE - CUBE_SIDE) / 2;
  return [
    `#viewcube { position: absolute; right: ${CUBE_RIGHT}px; top: ${CUBE_WRAP_TOP}px; width: ${CUBE_WRAP}px; height: ${CUBE_WRAP}px; z-index: 3; pointer-events: none; }`,
    `#viewcube .cube-stage { left: ${offset}px; top: ${offset}px; width: ${CUBE_STAGE}px; height: ${CUBE_STAGE}px; pointer-events: auto; }`,
    `#viewcube .cube-face { left: ${face}px; top: ${face}px; width: ${CUBE_SIDE}px; height: ${CUBE_SIDE}px; }`,
    `#viewcube .cube-arrow, #viewcube .cube-corner { position: absolute; padding: 0; display: grid; place-items: center; pointer-events: auto; border: 0; color: ${a.glyph}; opacity: ${a.restOpacity}; transition: opacity ${a.transitionSeconds}s, background ${a.transitionSeconds}s; }`,
    `#viewcube .cube-arrow { width: ${CUBE_NAV.arrow}px; height: ${CUBE_NAV.arrow}px; border-radius: 50%; background: ${a.fill}; }`,
    `#viewcube .cube-corner { width: ${CUBE_NAV.zone}px; height: ${CUBE_NAV.zone}px; border-radius: 50%; background: ${a.zoneFill}; }`,
    `#viewcube .cube-arrow svg { display: block; }`,
    `#viewcube:hover .cube-arrow, #viewcube:hover .cube-corner, #viewcube:focus-within .cube-arrow, #viewcube:focus-within .cube-corner { opacity: ${a.hoverOpacity}; }`,
    `#viewcube .cube-arrow:hover:not(:disabled) { background: ${a.hoverFill}; }`,
    `#viewcube .cube-corner:hover:not(:disabled) { background: ${a.zoneHoverFill}; }`,
    `#viewcube .cube-arrow:disabled, #viewcube .cube-corner:disabled { opacity: 0; pointer-events: none; }`,
    `#viewcube .cube-corner[hidden] { display: none; }`,
    `@media (prefers-reduced-motion: reduce) { #viewcube .cube-arrow, #viewcube .cube-corner { transition: none; } }`,
  ].join("\n");
}

/** Adds the stylesheet once (a no-op where there is no document head, as in the node tests). */
export function installCubeNavStyle(): void {
  const head = (globalThis as { document?: { head?: Node; getElementById?: (id: string) => unknown; createElement?: (t: string) => HTMLElement } }).document;
  if (!head?.head || !head.createElement || head.getElementById?.(STYLE_ID)) return;
  const el = head.createElement("style");
  el.id = STYLE_ID;
  el.textContent = cubeNavCss();
  head.head.appendChild(el);
}
