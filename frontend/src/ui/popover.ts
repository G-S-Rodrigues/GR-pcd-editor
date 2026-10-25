import { escapeInField } from "./keys";

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const TOP_BAR = 52;

export type Placement = "below" | "beside";

/**
 * Where a popover goes. `below` (default): centred under its anchor at bottom + 8. `beside`: right of the anchor at right + 8,
 * top - 10 (a row menu). Either flips above/up near the footer band and stays inside an 8 px margin.
 */
export function placePopover(anchor: Box, size: { w: number; h: number }, view: { w: number; h: number }, where: Placement = "below"): { x: number; y: number } {
  const clamp = (v: number, span: number, room: number) => Math.max(8, Math.min(v, room - span - 8));
  let y = where === "beside" ? anchor.top - 10 : anchor.top + anchor.height + 8;
  let top = 8;
  if (y + size.h > view.h - 34) {
    y = anchor.top - 8 - size.h;
    top = TOP_BAR + 8; // a flipped popover stays under the 52 px top bar (--tb-h) plus 8
  }
  const x = where === "beside" ? anchor.left + anchor.width + 8 : anchor.left + anchor.width / 2 - size.w / 2;
  return { x: clamp(x, size.w, view.w), y: Math.max(top, clamp(y, size.h, view.h)) };
}

export type PopEvent =
  | { type: "toggle"; id: string }
  | { type: "pointerdown"; inside: string | null; onAnchor: string | null }
  | { type: "escape"; inField: boolean }
  | { type: "close" };

/** The one-open-at-a-time rule: the id of the open popover after an event. */
export function popoverReducer(open: string | null, e: PopEvent): string | null {
  switch (e.type) {
    case "toggle":
      return open === e.id ? null : e.id;
    case "pointerdown":
      return open !== null && (e.inside === open || e.onAnchor === open) ? open : null;
    case "escape":
      return e.inField ? open : null;
    case "close":
      return null;
  }
}

export interface PopEntry {
  id: string;
  anchor: HTMLElement;
  panel: HTMLElement;
  /** Placement rule; centred below the anchor when absent. */
  where?: Placement;
  /** True for an entry whose anchor moves (`toggleAt`): the caller's button calls it, no click listener is bound. */
  movable?: boolean;
}

export interface PopDeps {
  listenPointerDown(f: (e: { target: unknown }) => void): void;
  listenKey(f: (e: { key: string; target: unknown }) => void): void;
  listenResize(f: () => void): void;
  viewport(): { w: number; h: number };
  /** The anchor's box and the panel's size, read after the panel is shown. */
  measure(anchor: HTMLElement, panel: HTMLElement): { anchor: Box; size: { w: number; h: number } };
}

/**
 * Wires popovers to their anchors. The listeners are registered by the caller, so main.ts owns their order:
 * the key listener must come after the global Escape listener (22-5, listener-order trap).
 */
export function bindPopovers(entries: PopEntry[], deps: PopDeps) {
  let open: string | null = null;
  const find = (id: string | null) => entries.find((e) => e.id === id);
  const place = () => {
    const e = find(open);
    if (!e) return;
    const m = deps.measure(e.anchor, e.panel);
    const p = placePopover(m.anchor, m.size, deps.viewport(), e.where);
    e.panel.style.left = `${p.x}px`;
    e.panel.style.top = `${p.y}px`;
  };
  const sync = (next: string | null) => {
    const before = open;
    open = next;
    for (const e of entries) {
      const on = e.id === open;
      e.anchor.setAttribute("aria-expanded", on ? "true" : "false");
      e.panel.hidden = !on;
      e.panel.classList.toggle("on", on);
    }
    if (open !== null && open !== before) {
      place();
      find(open)?.panel.focus();
    }
  };
  const apply = (ev: PopEvent) => sync(popoverReducer(open, ev));
  const moveAnchor = (e: PopEntry, anchor: HTMLElement) => {
    if (e.anchor === anchor) return;
    e.anchor.setAttribute("aria-expanded", "false");
    e.anchor = anchor;
    anchor.setAttribute("aria-controls", e.panel.getAttribute("id") ?? "");
    anchor.setAttribute("aria-expanded", "false");
  };
  const wire = (e: PopEntry) => {
    e.anchor.setAttribute("aria-controls", e.panel.getAttribute("id") ?? "");
    if (!e.movable) e.anchor.addEventListener("click", () => apply({ type: "toggle", id: e.id }));
  };
  for (const e of entries) wire(e);
  sync(null);
  deps.listenPointerDown((ev) => {
    const t = ev.target as Node | null;
    const inside = entries.find((e) => t !== null && e.panel.contains(t))?.id ?? null;
    const onAnchor = entries.find((e) => t !== null && e.anchor.contains(t))?.id ?? null;
    apply({ type: "pointerdown", inside, onAnchor });
  });
  deps.listenKey((ev) => {
    if (ev.key !== "Escape" || open === null) return;
    const t = ev.target as { tagName?: string; type?: string } | null;
    const was = open;
    apply({ type: "escape", inField: escapeInField(t?.tagName ?? "", t?.type ?? "") });
    if (open === null) find(was)?.anchor.focus();
  });
  deps.listenResize(place);
  return {
    /** Registers a popover after the manager was built (the tool panels, the Fit menu). */
    add: (e: PopEntry) => {
      entries.push(e);
      wire(e);
      sync(open);
    },
    /**
     * Opens `id` at `anchor`, moves it there when it is open at another anchor, closes it when it is open at this one.
     * For entries with a moving anchor (a row's `...` button): the caller's own click handler calls this.
     */
    toggleAt: (id: string, anchor: HTMLElement) => {
      const e = find(id);
      if (!e) return;
      if (open === id && e.anchor === anchor) return apply({ type: "close" });
      moveAnchor(e, anchor);
      if (open === id) {
        e.anchor.setAttribute("aria-expanded", "true");
        place();
      } else sync(id);
    },
    /** The anchor element was rebuilt: point the entry at the new one; when open, the new anchor takes the expanded mark and the panel is placed again (no refocus). */
    reanchor: (id: string, anchor: HTMLElement) => {
      const e = find(id);
      if (!e) return;
      moveAnchor(e, anchor);
      if (open === id) {
        anchor.setAttribute("aria-expanded", "true");
        place();
      }
    },
    isOpen: () => open !== null,
    openId: () => open,
    open: (id: string) => sync(id),
    toggle: (id: string) => apply({ type: "toggle", id }),
    close: () => apply({ type: "close" }),
    /** Places the open popover again (its content changed size); nothing when none is open. */
    replace: () => place(),
    /** Closes the named popover only when it is the open one. */
    closeIf: (id: string) => {
      if (open === id) apply({ type: "close" });
    },
  };
}

export type Popovers = ReturnType<typeof bindPopovers>;
