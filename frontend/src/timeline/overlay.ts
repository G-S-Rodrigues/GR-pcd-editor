import { BAND, BAR } from "../view/layout";

/**
 * Everything about how the history strip looks as an overlay on the stage's bottom edge, in one place to tweak.
 * The strip itself and its scroll and track layers let pointer events through; only the step cards, the marker and
 * the thin timeline line take them. Chips sit on a glass bar (--tl-bar) with --tl-text and a --tl-halo text shadow so
 * icons stay legible over a dark background and over bright points in both themes (UI-351, tokens in index.html).
 */
export const TL_STYLE = {
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
  const halo = "0 0 2px var(--tl-halo), 0 0 4px var(--tl-halo)";
  return [
    `#timeline { position: absolute; left: 0; right: 0; bottom: 0; height: ${BAND}px; background: transparent; border: 0; pointer-events: none; overflow: hidden; z-index: 3; }`,
    `#timeline[hidden] { display: none; }`,
    `#timeline-bar { position: absolute; left: 8px; right: 8px; bottom: ${BAR.bottom}px; height: ${BAR.h}px; display: flex; align-items: center; border-radius: 12px; background: var(--tl-bar); pointer-events: none; }`,
    `.tl-head { flex: none; display: flex; align-items: baseline; gap: 6px; padding: 0 10px 0 12px; color: var(--tl-text); font-size: 12px; white-space: nowrap; text-shadow: ${halo}; pointer-events: none; }`,
    `.tl-head b { font-weight: 600; }`,
    `.tl-head #tl-sum { font-variant-numeric: tabular-nums; opacity: 0.8; }`,
    `.tl-end { flex: none; display: flex; align-items: center; padding: 0 8px 0 4px; pointer-events: none; }`,
    `.tl-end #history-open { pointer-events: auto; }`,
    `#timeline-scroll { flex: 1 1 0; min-width: 0; height: 100%; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; pointer-events: none; }`,
    `#timeline-track { position: relative; height: 100%; min-width: 100%; pointer-events: none; }`,
    `.tl-line { position: absolute; left: 0; right: 0; top: ${BAR.h / 2 - s.lineHit / 2}px; height: ${s.lineHit}px; pointer-events: auto; }`,
    `.tl-line::before { content: ""; position: absolute; left: 0; right: 0; top: ${s.lineHit / 2}px; height: 1px; background: ${s.line}; box-shadow: 0 0 0 1px ${s.lineHalo}; }`,
    `.tl-empty { position: absolute; left: 12px; top: 12px; color: var(--tl-text); text-shadow: ${halo}; }`,
    `.step { position: absolute; top: 7px; height: 26px; box-sizing: border-box; display: inline-flex; align-items: center; gap: 6px; padding: 0 9px 0 8px; border: 0; border-radius: 8px; background: var(--fill-1); color: var(--tl-text); text-shadow: ${halo}; white-space: nowrap; overflow: hidden; cursor: default; pointer-events: auto; transition: opacity ${s.transitionSeconds}s; }`,
    `.step.greyed { opacity: ${s.greyedOpacity}; }`,
    `.step-count { color: var(--tl-text); }`,
    `#timeline-marker { position: absolute; top: 5px; width: 14px; height: 30px; cursor: ew-resize; z-index: 4; touch-action: none; pointer-events: auto; }`,
    `#timeline-marker .marker-grip { position: absolute; left: 5px; top: 0; width: 4px; height: 100%; background: var(--accent); border-radius: 2px; box-shadow: 0 0 0 1px ${s.lineHalo}; }`,
    `@media (max-width: 1699px) { .step .step-label { display: none; } .step:hover .step-label, .step:focus-within .step-label { display: inline; } .step:hover, .step:focus-within { width: max-content !important; z-index: 3; } }`,
    `@media (min-width: 1700px) { .step .step-label { display: inline; } }`,
    // a highlighted chip keeps its size while only focused (E2E-122); under the pointer it takes its content so Edit shape and the tools sit side by side
    `.step.highlighted:focus-within:not(:hover) { width: var(--chip-w) !important; }`,
    `.step.highlighted:not(:hover) .step-tools { display: none; }`,
    `.step.highlighted:hover .step-label, .step.highlighted:focus-within .step-label { display: none; }`,
    `.step-rename { flex: 1 1 auto; min-width: 72px; }`,
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
