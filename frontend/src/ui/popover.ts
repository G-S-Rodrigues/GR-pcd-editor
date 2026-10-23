import { escapeInField } from "./keys";

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where a popover goes: centred under its anchor at bottom + 8, above it when it would cross the footer band, inside an 8 px margin. */
export function placePopover(anchor: Box, size: { w: number; h: number }, view: { w: number; h: number }): { x: number; y: number } {
  const clamp = (v: number, span: number, room: number) => Math.max(8, Math.min(v, room - span - 8));
  let y = anchor.top + anchor.height + 8;
  if (y + size.h > view.h - 34) y = anchor.top - 8 - size.h;
  return { x: clamp(anchor.left + anchor.width / 2 - size.w / 2, size.w, view.w), y: clamp(y, size.h, view.h) };
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
    const p = placePopover(m.anchor, m.size, deps.viewport());
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
  for (const e of entries) {
    e.anchor.setAttribute("aria-controls", e.panel.getAttribute("id") ?? "");
    e.anchor.addEventListener("click", () => apply({ type: "toggle", id: e.id }));
  }
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
    isOpen: () => open !== null,
    openId: () => open,
    open: (id: string) => sync(id),
    toggle: (id: string) => apply({ type: "toggle", id }),
    close: () => apply({ type: "close" }),
    /** Closes the named popover only when it is the open one. */
    closeIf: (id: string) => {
      if (open === id) apply({ type: "close" });
    },
  };
}

export type Popovers = ReturnType<typeof bindPopovers>;
