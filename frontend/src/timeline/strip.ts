import type { AppState } from "../state/app";
import type { Store } from "../state/store";
import { control } from "../ui/controls";
import { h } from "../ui/dom";
import { installTimelineStyle } from "./overlay";
import {
  CARD_W,
  PAD,
  PITCH,
  slotX,
  type CardView,
  cancelRename,
  clearHighlight,
  clickStep,
  commitRename,
  dragCancel,
  dragEnd,
  dragMove,
  dragStart,
  escapeKey,
  nextFocus,
  setHover,
  slotFromX,
  sliderTarget,
  startRename,
  stripControlKey,
  stripKeyAction,
  timelineView,
} from "./model";

export interface TimelineActions {
  rollback(cursor: number): void;
  deleteStep(sid: number): void;
  renameStep(sid: number, name: string): void;
  /** The marker target asked for and not yet answered; keys move relative to it so rapid presses add up. */
  pendingCursor(): number | null;
}

const GLYPH: Record<string, string> = { box: "▢", polygon: "⬠", cluster: "⁘", filter: "≡", invalid: "⊘", other: "✂" };

/**
 * The history strip under the viewport: one card per applied or rolled-back deletion, a marker between cards. It only
 * draws `timelineView(state)` and turns gestures into the model transitions and the three actions; cards are patched
 * in place so a focused card keeps its focus across state changes.
 */
export function buildTimeline(root: HTMLElement, store: Store<AppState>, actions: TimelineActions): void {
  const scroller = h("div", { id: "timeline-scroll" });
  const track = h("div", { id: "timeline-track" });
  const empty = h("span", { class: "tl-empty" });
  const line = h("div", { class: "tl-line", "aria-hidden": "true" });
  installTimelineStyle();
  const marker = control("div", {
    id: "timeline-marker",
    role: "slider",
    tabindex: "0",
    "aria-label": "History marker: steps left of it are applied, steps right of it are rolled back",
    "aria-orientation": "horizontal",
  }, h("span", { class: "marker-grip" }));
  track.append(line, empty, marker);
  scroller.append(track);
  root.append(scroller);
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", "History timeline");

  const cards = new Map<number, HTMLElement>();
  let lastCount = 0;

  const label = (c: HTMLElement) => c.querySelector(".step-label") as HTMLElement;

  const setT = (fn: (t: AppState["timeline"]) => AppState["timeline"]) => store.set({ timeline: fn(store.get().timeline) });

  function makeCard(sid: number): HTMLElement {
    const btn = (act: string, text: string, title: string) =>
      h("button", { type: "button", "data-act": act, title, "aria-label": title, text, class: "step-btn" });
    const icon = h("span", { class: "step-icon" });
    const card = h(
      "div",
      { class: "step", "data-step": String(sid), tabindex: "0", role: "button" },
      icon,
      h("span", { class: "step-count" }),
      h("span", { class: "step-tools" }, btn("rollback", "⇤", "Roll back to here"), btn("rename", "✎", "Rename this step"), btn("delete", "×", "Delete this step")),
      h("span", { class: "step-label" }),
    );
    icon.addEventListener("click", () => setT((t) => clickStep(t, sid)));
    card.addEventListener("pointerenter", () => setT((t) => setHover(t, sid)));
    card.addEventListener("pointerleave", () => setT((t) => setHover(t, null)));
    label(card).addEventListener("dblclick", () => setT((t) => startRename(t, sid)));
    card.addEventListener("click", (e) => {
      const act = (e.target as HTMLElement).closest("[data-act]")?.getAttribute("data-act");
      if (!act) return;
      const idx = store.get().session?.history.entries.findIndex((x) => (x.sid ?? x.index) === sid) ?? -1;
      if (act === "rollback" && idx >= 0) actions.rollback(idx + 1);
      else if (act === "rename") setT((t) => startRename(t, sid));
      else if (act === "delete") actions.deleteStep(sid);
    });
    return card;
  }

  function endRename(card: HTMLElement, sid: number, commit: boolean, text: string): void {
    const t = store.get().timeline;
    if (t.renaming !== sid) return;
    if (!commit) {
      store.set({ timeline: cancelRename(t) });
    } else {
      const r = commitRename(t, text);
      store.set({ timeline: r.timeline });
      const cur = store.get().session?.history.entries.find((x) => (x.sid ?? x.index) === sid);
      if (r.name !== null && (cur?.name ?? "") !== r.name) actions.renameStep(sid, r.name);
    }
    card.focus();
  }

  function patchLabel(card: HTMLElement, c: CardView): void {
    const lab = label(card);
    const input = card.querySelector("input.step-rename") as HTMLInputElement | null;
    if (c.renaming && !input) {
      const inp = h("input", { class: "step-rename", type: "text", maxlength: "80", "aria-label": "Step name", value: c.name ?? "" }) as HTMLInputElement;
      inp.value = c.name ?? "";
      let done = false;
      const finish = (commit: boolean) => {
        if (done) return;
        done = true;
        endRename(card, c.sid, commit, inp.value);
      };
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") finish(true);
        else if (e.key === "Escape") finish(false);
        else return;
        e.stopPropagation();
        e.preventDefault();
      });
      inp.addEventListener("blur", () => finish(true));
      inp.addEventListener("dblclick", (e) => e.stopPropagation());
      lab.style.display = "none";
      card.append(inp);
      inp.focus();
      inp.select();
    } else if (!c.renaming && input) {
      input.remove();
      lab.style.display = "";
    }
    lab.textContent = c.label;
    lab.title = c.name ?? "";
  }

  function render(): void {
    const s = store.get();
    const v = timelineView(s.session, s.timeline);
    root.hidden = v.hidden;
    if (v.hidden) return;
    track.style.width = `${v.trackWidth}px`;
    empty.textContent = v.empty ? v.emptyText : "";
    const live = new Set(v.cards.map((c) => c.sid));
    for (const [sid, el] of cards) {
      if (!live.has(sid)) {
        el.remove();
        cards.delete(sid);
      }
    }
    v.cards.forEach((c, i) => {
      let el = cards.get(c.sid);
      if (!el) {
        el = makeCard(c.sid);
        cards.set(c.sid, el);
        track.insertBefore(el, marker);
      }
      el.style.left = `${PAD + i * PITCH}px`;
      el.style.width = `${CARD_W}px`;
      el.classList.toggle("greyed", c.greyed);
      el.classList.toggle("highlighted", c.highlighted);
      el.setAttribute("aria-pressed", String(c.highlighted));
      el.setAttribute("data-icon", c.icon);
      el.setAttribute("data-tool", c.tool);
      el.title = c.tooltip;
      (el.querySelector(".step-icon") as HTMLElement).textContent = GLYPH[c.icon] ?? GLYPH.other;
      (el.querySelector(".step-count") as HTMLElement).textContent = c.count.toLocaleString("en-US");
      patchLabel(el, c);
      if (track.children[i + 2] !== el) track.insertBefore(el, track.children[i + 2] ?? marker);
    });
    marker.style.left = `${slotX(s.timeline.dragging ?? v.marker.slot) - 7}px`;
    marker.classList.toggle("dragging", s.timeline.dragging !== null);
    marker.setAttribute("aria-valuemin", "0");
    marker.setAttribute("aria-valuemax", String(v.marker.max));
    marker.setAttribute("aria-valuenow", String(v.marker.now));
    marker.setAttribute("aria-valuetext", v.marker.valuetext);
    if (v.cards.length > lastCount) scroller.scrollLeft = scroller.scrollWidth;
    lastCount = v.cards.length;
  }

  // ---- marker drag: nothing is sent while dragging, one rollback on release
  const nSteps = () => store.get().session?.history.entries.length ?? 0;
  const cursor = () => store.get().session?.history.cursor ?? 0;
  const slotAt = (clientX: number) => slotFromX(clientX - scroller.getBoundingClientRect().left + scroller.scrollLeft, nSteps());
  marker.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    marker.setPointerCapture(e.pointerId);
    marker.focus();
    setT((t) => dragStart(t, cursor()));
    e.preventDefault();
  });
  marker.addEventListener("pointermove", (e) => {
    if (store.get().timeline.dragging === null) return;
    const slot = slotAt(e.clientX);
    setT((t) => dragMove(t, slot));
  });
  const release = (e: PointerEvent, cancel: boolean) => {
    if (store.get().timeline.dragging === null) return;
    const t = store.get().timeline;
    const r = cancel ? { timeline: dragCancel(t), rollbackTo: null } : dragEnd(dragMove(t, slotAt(e.clientX)), cursor());
    store.set({ timeline: r.timeline });
    if (r.rollbackTo !== null) actions.rollback(r.rollbackTo);
  };
  marker.addEventListener("pointerup", (e) => release(e, false));
  marker.addEventListener("pointercancel", (e) => release(e, true));

  // ---- keyboard
  root.addEventListener("keydown", (e) => {
    const tgt = e.target as HTMLElement;
    const isMarker = tgt === marker;
    if (tgt.tagName === "BUTTON" || isMarker) {
      // Enter/Space activate a button natively; Delete/Backspace must not reach the global Delete = Apply handler
      const key = stripControlKey(e.key, isMarker ? "marker" : "button");
      if (key) {
        e.stopPropagation();
        e.preventDefault();
        const owner = tgt.closest(".step");
        if (key === "delete" && owner) actions.deleteStep(Number(owner.getAttribute("data-step")));
        return;
      }
      if (!isMarker) return;
    }
    const where = tgt.tagName === "INPUT" ? "input" : isMarker ? "marker" : "step";
    const act = stripKeyAction(e.key, where);
    if (!act) return;
    const card = tgt.closest(".step") as HTMLElement | null;
    const sid = card ? Number(card.getAttribute("data-step")) : NaN;
    e.stopPropagation();
    e.preventDefault();
    if (act.type === "slider") {
      const to = sliderTarget(e.key, actions.pendingCursor() ?? cursor(), nSteps());
      if (to !== null) actions.rollback(to);
    } else if (act.type === "focus" && card) {
      const order = [...cards.values()];
      const next = order[nextFocus(order.indexOf(card), e.key, order.length)];
      next?.focus();
    } else if (act.type === "highlight" && card) setT((t) => clickStep(t, sid));
    else if (act.type === "rename" && card) setT((t) => startRename(t, sid));
    else if (act.type === "delete" && card) actions.deleteStep(sid);
  });
  // Esc: ends a drag, a rename, then clears the highlight (the key still reaches the other Esc handlers)
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const t = store.get().timeline;
    const r = escapeKey(t);
    if (r.used && r.timeline !== t) store.set({ timeline: r.timeline });
  });
  // a click on the strip's own background clears the highlight
  scroller.addEventListener("click", (e) => {
    if (e.target === scroller || e.target === track || e.target === line) setT(clearHighlight);
  });

  store.subscribe(render);
  render();
}
