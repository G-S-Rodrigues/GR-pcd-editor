import { expect, test } from "vitest";
import { FakeEl } from "../testing/fakedom";
import { bindPopovers, placePopover, popoverReducer } from "./popover";

const VIEW = { w: 1280, h: 720 };

test("UI-1130 placePopover centres under the anchor at bottom + 8, flips above near the footer, clamps to an 8 px margin", () => {
  const size = { w: 300, h: 200 };
  // centre
  expect(placePopover({ left: 600, top: 10, width: 40, height: 30 }, size, VIEW)).toEqual({ x: 470, y: 48 });
  // left edge: clamped to 8
  expect(placePopover({ left: 0, top: 10, width: 40, height: 30 }, size, VIEW)).toEqual({ x: 8, y: 48 });
  // right edge: clamped to view - size - 8
  expect(placePopover({ left: 1240, top: 10, width: 40, height: 30 }, size, VIEW)).toEqual({ x: 972, y: 48 });
  // flip: bottom + 8 + h = 718 > 720 - 34
  expect(placePopover({ left: 600, top: 480, width: 40, height: 30 }, size, VIEW)).toEqual({ x: 470, y: 272 });
  // too tall for either side: clamped to the top margin
  expect(placePopover({ left: 600, top: 10, width: 40, height: 30 }, { w: 300, h: 900 }, VIEW)).toEqual({ x: 470, y: 8 });
});

test("UI-1131 popoverReducer: toggle opens, closes and switches; an outside pointerdown closes; Esc closes unless typed in a text field", () => {
  expect(popoverReducer(null, { type: "toggle", id: "a" })).toBe("a");
  expect(popoverReducer("a", { type: "toggle", id: "a" })).toBeNull();
  expect(popoverReducer("a", { type: "toggle", id: "b" })).toBe("b");
  expect(popoverReducer("a", { type: "pointerdown", inside: null, onAnchor: null })).toBeNull();
  expect(popoverReducer("a", { type: "pointerdown", inside: "a", onAnchor: null })).toBe("a");
  expect(popoverReducer("a", { type: "pointerdown", inside: null, onAnchor: "a" })).toBe("a");
  expect(popoverReducer("a", { type: "pointerdown", inside: null, onAnchor: "b" })).toBeNull();
  expect(popoverReducer(null, { type: "pointerdown", inside: null, onAnchor: null })).toBeNull();
  expect(popoverReducer("a", { type: "escape", inField: false })).toBeNull();
  expect(popoverReducer("a", { type: "escape", inField: true })).toBe("a");
  expect(popoverReducer("a", { type: "close" })).toBeNull();
});

function setup() {
  const mk = (id: string) => {
    const anchor = new FakeEl("button");
    const panel = new FakeEl("div");
    panel.setAttribute("id", id);
    panel.hidden = true;
    const inner = new FakeEl("input");
    panel.append(inner);
    return { id, anchor, panel, inner };
  };
  const a = mk("pa");
  const b = mk("pb");
  let down: (e: { target: unknown }) => void = () => undefined;
  let key: (e: { key: string; target: unknown }) => void = () => undefined;
  const pops = bindPopovers(
    [
      { id: "a", anchor: a.anchor as unknown as HTMLElement, panel: a.panel as unknown as HTMLElement },
      { id: "b", anchor: b.anchor as unknown as HTMLElement, panel: b.panel as unknown as HTMLElement },
    ],
    {
      listenPointerDown: (f) => (down = f as typeof down),
      listenKey: (f) => (key = f as typeof key),
      listenResize: () => undefined,
      viewport: () => VIEW,
      measure: () => ({ anchor: { left: 600, top: 10, width: 40, height: 30 }, size: { w: 300, h: 200 } }),
    },
  );
  return { a, b, pops, down: (t: unknown) => down({ target: t }), key: (k: string, target: unknown = {}) => key({ key: k, target }) };
}

test("UI-1132 bindPopovers mirrors the state on the anchor and panel, focuses the panel on open and the anchor on an Esc close, one popover at a time", () => {
  const s = setup();
  expect(s.pops.isOpen()).toBe(false);
  expect(s.a.anchor.getAttribute("aria-expanded")).toBe("false");
  expect(s.a.anchor.getAttribute("aria-controls")).toBe("pa");
  expect(s.a.panel.hidden).toBe(true);
  s.a.anchor.fire("click");
  expect(s.pops.openId()).toBe("a");
  expect(s.a.anchor.getAttribute("aria-expanded")).toBe("true");
  expect(s.a.panel.hidden).toBe(false);
  expect(s.a.panel.classList.contains("on")).toBe(true);
  expect(s.a.panel.focused).toBe(1);
  expect(s.a.panel.style.left).toBe("470px");
  expect(s.a.panel.style.top).toBe("48px");
  // opening b closes a
  s.b.anchor.fire("click");
  expect(s.pops.openId()).toBe("b");
  expect(s.a.panel.hidden).toBe(true);
  expect(s.a.anchor.getAttribute("aria-expanded")).toBe("false");
  // a pointerdown inside b, or on its anchor, keeps it; elsewhere closes it
  s.down(s.b.inner);
  s.down(s.b.anchor);
  expect(s.pops.openId()).toBe("b");
  s.down(new FakeEl("canvas"));
  expect(s.pops.isOpen()).toBe(false);
  expect(s.b.panel.focused).toBe(1);
  expect(s.b.anchor.focused).toBe(0); // a pointer close does not steal focus
  // Esc closes and returns focus to the anchor; Esc typed in a text field does not
  s.a.anchor.fire("click");
  s.key("Escape", { tagName: "INPUT", type: "text" });
  expect(s.pops.openId()).toBe("a");
  s.key("Escape", { tagName: "INPUT", type: "range" });
  expect(s.pops.isOpen()).toBe(false);
  expect(s.a.anchor.focused).toBe(1);
  // Esc with nothing open does nothing
  s.key("Escape");
  expect(s.a.anchor.focused).toBe(1);
  // programmatic open and a close that names an entry
  s.pops.open("b");
  s.pops.closeIf("a");
  expect(s.pops.openId()).toBe("b");
  s.pops.closeIf("b");
  expect(s.pops.isOpen()).toBe(false);
});
