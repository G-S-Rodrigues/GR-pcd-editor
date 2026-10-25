import { afterAll, expect, test, vi } from "vitest";
import { createAppStore } from "../state/app";
import type { HistoryEntry } from "../state/types";
import { FakeEl, installFakeDom } from "../testing/fakedom";
import { sessionFixture } from "../testing/fixtures";
import { CARD_W, CARD_W_WIDE, GAP, PAD, slotX } from "./model";

/** FakeEl plus the few tree operations the strip uses (querySelector by .class / tag.class / [attr="v"], insertBefore, remove). */
class LiveEl extends FakeEl {
  parent: LiveEl | null = null;
  scrollLeft = 0;
  scrollWidth = 0;
  override append(...c: (FakeEl | string)[]): void {
    super.append(...c);
    for (const x of c) if (typeof x !== "string") (x as LiveEl).parent = this;
  }
  insertBefore(el: LiveEl, ref: LiveEl | null | undefined): void {
    const i = this.children.indexOf(el);
    if (i >= 0) this.children.splice(i, 1);
    const at = ref ? this.children.indexOf(ref) : -1;
    if (at < 0) this.children.push(el);
    else this.children.splice(at, 0, el);
    el.parent = this;
  }
  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
  setPointerCapture(): void {}
  querySelector(sel: string): LiveEl | null {
    const m = sel.match(/^([a-z]*)(?:\.([\w-]+))?(?:\[([\w-]+)="([^"]*)"\])?$/);
    if (!m) throw new Error(`unsupported selector ${sel}`);
    const [, tag, cls, attr, val] = m;
    return (this.all().find((e) => (!tag || e.tag === tag) && (!cls || e.classList.contains(cls)) && (!attr || e.getAttribute(attr) === val)) as LiveEl | undefined) ?? null;
  }
}

const dom = installFakeDom();
const g = globalThis as unknown as { document: { createElement: (t: string) => FakeEl } };
g.document.createElement = (t: string) => new LiveEl(t);
afterAll(() => dom.restore());

const entry = (i: number, tool: string): HistoryEntry => ({ index: i, sid: i + 10, kind: "delete", tool, name: null, description: `Delete ${(i + 1) * 1000} points (${tool})`, count: (i + 1) * 1000 });
const session = (cursor: number) => sessionFixture({ history: { entries: ["box", "cluster", "polygon"].map((t, i) => entry(i, t)), cursor, can_undo: cursor > 0, can_redo: cursor < 3 } });
const actions = { rollback: () => undefined, deleteStep: () => undefined, renameStep: () => undefined, pendingCursor: () => null, editShape: () => undefined };

/** A fresh module graph per build: the control registry refuses a second `timeline-marker`. */
async function build(wide: boolean) {
  vi.resetModules();
  const { buildTimeline } = await import("./strip");
  const store = createAppStore();
  store.set({ session: session(2) });
  const root = new LiveEl("section");
  buildTimeline(root as unknown as HTMLElement, store, actions, { wide: () => wide });
  return { store, root };
}

test("UI-1240 the strip is a bar with a head (Timeline, k of n), the scroller and an end slot; chips and the marker follow the breakpoint's chip width", async () => {
  for (const wide of [false, true]) {
    const w = wide ? CARD_W_WIDE : CARD_W;
    const { root } = await build(wide);
    const bar = root.children[0];
    expect(bar.getAttribute("id")).toBe("timeline-bar");
    expect(bar.children.map((c) => c.className || c.getAttribute("id"))).toEqual(["tl-head", "timeline-scroll", "tl-end"]);
    expect(bar.children[0].text()).toBe("Timeline2 of 3");
    expect(root.all().find((e) => e.getAttribute("id") === "tl-sum")!.text()).toBe("2 of 3");
    const cards = root.all().filter((e) => e.classList.contains("step"));
    expect(cards).toHaveLength(3);
    cards.forEach((c, i) => {
      expect(c.style.left, `card ${i} left (wide ${wide})`).toBe(`${PAD + i * (w + GAP)}px`);
      expect(c.style.width, `card ${i} width (wide ${wide})`).toBe(`${w}px`);
    });
    const marker = root.all().find((e) => e.getAttribute("id") === "timeline-marker")!;
    expect(marker.style.left).toBe(`${slotX(2, w) - 7}px`);
  }
});

test("UI-1242 with no steps the line and the marker are hidden, so \"No steps yet\" sits on a clear bar; they return with the first step", async () => {
  const { store, root } = await build(false);
  const line = root.all().find((e) => e.classList.contains("tl-line"))!;
  const marker = root.all().find((e) => e.getAttribute("id") === "timeline-marker")!;
  const empty = root.all().find((e) => e.classList.contains("tl-empty"))!;
  expect(line.hidden).toBe(false);
  expect(marker.hidden).toBe(false);
  expect(empty.text()).toBe("");
  store.set({ session: sessionFixture({ history: { entries: [], cursor: 0, can_undo: false, can_redo: false } }) });
  expect(empty.text()).toBe("No steps yet");
  expect(line.hidden).toBe(true);
  expect(marker.hidden).toBe(true);
  store.set({ session: session(1) });
  expect(line.hidden).toBe(false);
  expect(marker.hidden).toBe(false);
});
