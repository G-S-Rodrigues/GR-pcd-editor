import { BAND } from "../view/layout";

/**
 * Everything about how the history strip looks as an overlay on the stage's bottom edge, in one place to tweak.
 * The strip itself and its scroll and track layers let pointer events through; only the step cards, the marker and
 * the thin timeline line take them. Cards are translucent with a light text colour and a dark halo so icons stay
 * legible over a dark background and over bright points (UI-351).
 */
export const TL_STYLE = {
  /** Card background colour and its opacity (the cloud shows through). */
  cardRgb: "#10141a",
  cardAlpha: 0.72,
  cardBorder: "rgba(255,255,255,0.35)",
  /** Icon, count and label colour. */
  text: "#ffffff",
  /** Dark halo around glyphs and the line. */
  halo: "rgba(0,0,0,0.9)",
  line: "rgba(255,255,255,0.7)",
  lineHalo: "rgba(0,0,0,0.5)",
  /** Height of the clickable strip around the 1 px line. */
  lineHit: 14,
  greyedOpacity: 0.6,
  transitionSeconds: 0.15,
} as const;

const rgb = (c: string): [number, number, number] => {
  const v = Number.parseInt(c.replace("#", ""), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

/** `fg` at opacity `alpha` over `under`, as #rrggbb (the colour the card shows over a given point colour). */
export function blend(fg: string, alpha: number, under: string): string {
  const [a, b] = [rgb(fg), rgb(under)];
  return `#${a.map((x, i) => Math.round(x * alpha + b[i] * (1 - alpha)).toString(16).padStart(2, "0")).join("")}`;
}

export const STYLE_ID = "timeline-overlay-style";

/** The stylesheet text for the strip (also read by the tests); one rule per line. */
export function timelineCss(): string {
  const s = TL_STYLE;
  const [r, g, b] = rgb(s.cardRgb);
  const halo = `0 0 2px ${s.halo}, 0 0 4px ${s.halo}`;
  return [
    `#timeline { position: absolute; left: 0; right: 0; bottom: 0; height: ${BAND}px; background: transparent; border: 0; pointer-events: none; overflow: hidden; z-index: 3; }`,
    `#timeline[hidden] { display: none; }`,
    `#timeline-scroll { height: 100%; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; pointer-events: none; }`,
    `#timeline-track { position: relative; height: 100%; min-width: 100%; pointer-events: none; }`,
    `.tl-line { position: absolute; left: 0; right: 0; top: ${BAND / 2 - s.lineHit / 2}px; height: ${s.lineHit}px; pointer-events: auto; }`,
    `.tl-line::before { content: ""; position: absolute; left: 0; right: 0; top: ${s.lineHit / 2}px; height: 1px; background: ${s.line}; box-shadow: 0 0 0 1px ${s.lineHalo}; }`,
    `.tl-empty { position: absolute; left: 24px; top: 14px; color: ${s.text}; text-shadow: ${halo}; }`,
    `.step { position: absolute; top: 3px; height: 40px; padding: 3px 5px; border: 1px solid ${s.cardBorder}; border-radius: 5px; background: rgba(${r},${g},${b},${s.cardAlpha}); color: ${s.text}; text-shadow: ${halo}; overflow: hidden; cursor: default; pointer-events: auto; transition: opacity ${s.transitionSeconds}s; }`,
    `.step.greyed { opacity: ${s.greyedOpacity}; }`,
    `.step-count { color: ${s.text}; }`,
    `#timeline-marker { position: absolute; top: 1px; width: 14px; height: ${BAND - 2}px; cursor: ew-resize; z-index: 2; touch-action: none; pointer-events: auto; }`,
    `#timeline-marker .marker-grip { position: absolute; left: 5px; top: 0; width: 4px; height: 100%; background: var(--accent); border-radius: 2px; box-shadow: 0 0 0 1px ${s.lineHalo}; }`,
    `@media (prefers-reduced-motion: reduce) { .step { transition: none; } }`,
  ].join("\n");
}

/** Adds the stylesheet once (a no-op where there is no document head, as in the node tests). */
export function installTimelineStyle(): void {
  const head = (globalThis as { document?: { head?: Node; getElementById?: (id: string) => unknown; createElement?: (t: string) => HTMLElement } }).document;
  if (!head?.head || !head.createElement || head.getElementById?.(STYLE_ID)) return;
  const el = head.createElement("style");
  el.id = STYLE_ID;
  el.textContent = timelineCss();
  head.head.appendChild(el);
}
