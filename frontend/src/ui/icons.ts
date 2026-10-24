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

/** A filled dot (the mockup sheet's `fill="currentColor"` circles). */
const cf = (cx: number, cy: number, r: number): IconNode => ({ tag: "circle", attrs: { cx: String(cx), cy: String(cy), r: String(r), fill: "currentColor" } });
const dashed = (n: IconNode, dash: string): IconNode => ({ tag: n.tag, attrs: { ...n.attrs, "stroke-dasharray": dash } });

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
  /** Not in the sheet (22-7): the layer row and footer icons. */
  lock: [r(5, 11, 14, 10, 2), p("M8 11V8a4 4 0 0 1 8 0v3")],
  more: [cf(5, 12, 1.6), cf(12, 12, 1.6), cf(19, 12, 1.6)],
  shieldplus: [p("M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z"), p("M12 9v6M9 12h6")],
  assign: [p("M12 5v14M5 12h14")],
  release: [p("M19 12H5M11 6l-6 6 6 6")],
  /** Not in the sheet (22-7): the Selection action icons. */
  selectall: [dashed(r(4, 4, 16, 16, 2), "3 3"), c(9, 10, 0.8), c(14, 9, 0.8), c(12, 15, 0.8)],
  invert: [r(4, 4, 16, 16, 2), pa("M12 4v16M12 4h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6z", { fill: "currentColor" })],
  clear: [p("M6 6l12 12M18 6 6 18")],
  /** Not in the sheet: the protected-layer mark (22-2, R22-3), the mockup's shield outline with a tick. */
  shield: [p("M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z"), p("m9 12 2 2 4-4")],
  /** Not in the sheet (22-5, mockup-22): the app mark, a cube. */
  box: [p("M12 3 4 7.5v9L12 21l8-4.5v-9z"), p("M4 7.5 12 12l8-4.5M12 12v9")],
  /** Not in the sheet (22-5, mockup-22): the Display popover anchor. */
  sliders: [p("M4 7h9m4 0h3M4 17h3m4 0h9"), c(15, 7, 2), c(9, 17, 2)],
  /** Not in the sheet (22-5, mockup-22): the Cloud details anchor; the dot has no fill, as the orig icon's. */
  info: [c(12, 12, 9), p("M12 11v5.5"), c(12, 7.8, 0.6)],
  /** Not in the sheet (22-5, mockup-22): the Keyboard popover anchor. */
  keyboard: [r(3, 6, 18, 12, 2), p("M7 10h.01M11 10h.01M15 10h.01M7 14h10")],
  /** Not in the sheet (22-5, mockup-22): the History popover anchor. */
  list: [p("M9 6h11M9 12h11M9 18h11"), c(4.5, 6, 0.9), c(4.5, 12, 0.9), c(4.5, 18, 0.9)],
  /** Not in the sheet (22-5, mockup-22): invalid points. */
  invalid: [c(12, 12, 8.5), p("m6 6 12 12")],
  /** Not in the sheet (22-6, mockup-22): the tool palette glyphs and the inspector controls. */
  poly: [p("M12 3.5 20 9l-3 10.5H7L4 9z"), cf(12, 3.5, 1.6), cf(20, 9, 1.6), cf(17, 19.5, 1.6), cf(7, 19.5, 1.6), cf(4, 9, 1.6)],
  cluster: [cf(9, 9, 1.4), cf(13, 7, 1.4), cf(12, 11.5, 1.4), cf(8, 13, 1.4), cf(15.5, 11, 1.4), dashed(c(12, 10, 7.5), "2.2 2.2"), p("m17.5 16 3.5 3.5")],
  sparse: [cf(5, 6, 1.3), cf(18, 5, 1.3), cf(11, 12, 1.3), cf(4, 18, 1.3), cf(19, 17, 1.3), pa("M14.5 19.5 20 14", { opacity: ".55" })],
  plane: [p("M3 15.5 9 9h12l-6 6.5z"), p("M12 9V3.5m0 0-2 2m2-2 2 2")],
  thin: [cf(5, 5, 1.2), cf(12, 5, 1.2), cf(19, 5, 1.2), cf(5, 12, 1.2), cf(12, 12, 1.2), cf(19, 12, 1.2), cf(5, 19, 1.2), cf(19, 19, 1.2), dashed(r(9, 16, 6, 6, 1.4), "1.6 1.6")],
  rect: [dashed(r(4, 6, 16, 12, 1.5), "2.5 2")],
  level: [r(2.5, 8.5, 19, 7, 3.5), r(9.5, 10.5, 5, 3, 1.5)],
  close: [p("M6 6l12 12M18 6 6 18")],
  chevr: [p("m9 6 6 6-6 6")],
  /** Not in the sheet (22-8, mockup-22): the Reset filters button on the canvas (a funnel with a cross). */
  filterx: [p("M3 5h15l-5.5 6.5V18l-3 1.5v-8z"), p("m16 15 5 5m0-5-5 5")],
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
