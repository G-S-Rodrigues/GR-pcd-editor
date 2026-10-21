/** Icon node data from the approved symbol sheet (review/symbol-sheet.html), 24 x 24 grid, drawn as 2 px strokes. */
export interface IconNode {
  tag: "path" | "circle" | "rect";
  attrs: Record<string, string>;
}

const p = (d: string): IconNode => ({ tag: "path", attrs: { d } });
const c = (cx: number, cy: number, r: number): IconNode => ({ tag: "circle", attrs: { cx: String(cx), cy: String(cy), r: String(r) } });
const r = (x: number, y: number, w: number, h: number, rx: number): IconNode => ({
  tag: "rect",
  attrs: { x: String(x), y: String(y), width: String(w), height: String(h), rx: String(rx) },
});

const pa = (d: string, extra: Record<string, string>): IconNode => ({ tag: "path", attrs: { d, ...extra } });

export const ICONS = {
  open: [p("M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z")],
  save: [p("M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"), p("M7 3v5h8V3M7 21v-7h10v7")],
  exp: [p("M12 15V3M8 7l4-4 4 4M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5")],
  undo: [p("M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3")],
  redo: [p("m15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3")],
  orig: [r(3, 3, 18, 18, 2), c(8, 9, 0.6), c(15, 8, 0.6), c(10, 15, 0.6), c(16, 16, 0.6), c(17, 12, 0.6)],
  edit: [r(3, 3, 18, 18, 2), c(8, 9, 0.6), c(14, 8, 0.6), p("m9 16 3 3 6-7")],
  ovl: [r(3, 3, 12, 12, 2), r(9, 9, 12, 12, 2)],
  split: [r(3, 3, 18, 18, 2), p("M12 3v18"), c(7.5, 9, 0.6), c(8, 15, 0.6), p("m15 15 3-3")],
  persp: [p("M4 20 8.5 6h7L20 20z"), p("M8.5 6 4 20M15.5 6 20 20M6.2 13h11.6")],
  ortho: [r(5, 5, 14, 14, 1), p("M5 12h14M12 5v14")],
  fit: [p("M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"), c(12, 12, 2.5)],
  rpiv: [p("M4 12a8 8 0 1 0 2.5-5.8M4 4v4.5h4.5"), c(12, 12, 1.5)],
  ppiv: [c(12, 12, 6), c(12, 12, 1.2), p("M12 2v4M12 18v4M2 12h4M18 12h4")],
  help: [p("M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z")],
  chev: [p("m6 9 6 6 6-6")],
  add: [p("M12 5v14M5 12h14")],
  sub: [p("M5 12h14")],
  /** Intersect, candidate 1 of the sheet (two circles with a heavy lens, outer arcs faded). */
  int: [
    pa("M12 6.8A6 6 0 1 0 12 17.2", { opacity: ".45" }),
    pa("M12 17.2A6 6 0 1 0 12 6.8", { opacity: ".45" }),
    pa("M12 6.8A6 6 0 0 1 12 17.2A6 6 0 0 1 12 6.8z", { "stroke-width": "2.4" }),
  ],
  trash: [p("M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6")],
  eye: [p("M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"), c(12, 12, 3)],
  eyeoff: [
    p("M10.6 5.1A9.7 9.7 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.6A17 17 0 0 0 2 12s4 7 10 7a9.6 9.6 0 0 0 4.1-.9"),
    p("M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18"),
  ],
  /** Not in the sheet: a plain up arrow, rotated by the caller (ViewCube arrows, part 12-4). */
  arrow: [p("M12 19V5M6 11l6-6 6 6")],
  /** Not in the sheet: a plain pencil for the polygon edit mode (part 13-7). */
  pencil: [p("M4 20l1-4L16 5l3 3L8 19z"), p("M14 7l3 3")],
  /** Not in the sheet: a dotted box with a point, for "select this layer's points" (part 17-10). */
  pick: [r(4, 4, 16, 16, 2), c(12, 12, 2)],
} as const satisfies Record<string, readonly IconNode[]>;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

const SVG_NS = "http://www.w3.org/2000/svg";

/** A decorative svg (aria-hidden) that takes the surrounding text colour; the button around it carries the name. */
export function iconSvg(name: IconName, size = 20): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  for (const [k, v] of Object.entries({
    viewBox: "0 0 24 24",
    width: String(size),
    height: String(size),
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    focusable: "false",
    "data-icon": name,
  })) {
    svg.setAttribute(k, v);
  }
  for (const n of ICONS[name]) {
    const el = document.createElementNS(SVG_NS, n.tag);
    for (const [k, v] of Object.entries(n.attrs)) el.setAttribute(k, v);
    svg.append(el);
  }
  return svg;
}
