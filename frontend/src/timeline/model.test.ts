import { describe, expect, test } from "vitest";
import { PALETTE } from "../colour/palette";
import type { HistoryEntry } from "../state/types";
import { sessionFixture } from "../testing/fixtures";
import {
  CARD_W,
  CARD_W_WIDE,
  GAP,
  PAD,
  clearHighlight,
  markerSlots,
  clickStep,
  commitRename,
  dragCancel,
  dragEnd,
  dragMove,
  dragStart,
  discardCount,
  discardText,
  deleteLayerStepText,
  deleteStepText,
  STEP_GLYPH,
  deleteState,
  emptyTimeline,
  escapeKey,
  iconFor,
  nextFocus,
  reconcile,
  setHover,
  slotFromX,
  slotX,
  sliderTarget,
  startRename,
  cancelRename,
  stepLayerStyle,
  stepTooltip,
  stepsOf,
  stripControlKey,
  stripKeyAction,
  timelineView,
} from "./model";

const entry = (i: number, tool: string, count: number, name: string | null = null): HistoryEntry => ({
  index: i,
  sid: i + 10,
  kind: "delete",
  tool,
  name,
  description: `Delete ${count} points (${tool})`,
  count,
});
const sess = (cursor: number, tools = ["box", "cluster", "polygon"]) =>
  sessionFixture({
    history: {
      entries: tools.map((t, i) => entry(i, t, (i + 1) * 1000)),
      cursor,
      can_undo: cursor > 0,
      can_redo: cursor < tools.length,
    },
  });

describe("steps", () => {
  test("UI-233 stepsOf: default label, greyed flag from the cursor, optional wire fields fall back", () => {
    const steps = stepsOf(sess(2));
    expect(steps.map((s) => s.sid)).toEqual([10, 11, 12]);
    expect(steps.map((s) => s.label)).toEqual(["Box 1", "Cluster 2", "Polygon 3"]);
    expect(steps.map((s) => s.greyed)).toEqual([false, false, true]);
    expect(steps.map((s) => s.count)).toEqual([1000, 2000, 3000]);
    const named = stepsOf(sessionFixture({ history: { entries: [entry(0, "box", 5, "Mirror")], cursor: 1, can_undo: true, can_redo: false } }));
    expect(named[0].label).toBe("Mirror");
    // an entry without sid/tool/name (old fixture) still makes a step
    const old = stepsOf(
      sessionFixture({ history: { entries: [{ index: 0, kind: "delete", description: "x", count: 3 }], cursor: 1, can_undo: true, can_redo: false } }),
    );
    expect(old[0]).toMatchObject({ sid: 0, tool: "selection", name: null, greyed: false });
    expect(stepsOf(null)).toEqual([]);
  });

  test("UI-234 stepTooltip: exact text, greyed suffix, singular", () => {
    expect(stepTooltip({ tool: "cluster", name: null, count: 8397, greyed: false })).toMatch(/^Cluster delete, 8,397 points/);
    expect(stepTooltip({ tool: "cluster", name: null, count: 8397, greyed: false }).startsWith("Cluster delete, 8,397 points")).toBe(true);
    expect(stepTooltip({ tool: "box", name: null, count: 1, greyed: false })).toContain("Box delete, 1 point");
    expect(stepTooltip({ tool: "box", name: null, count: 1, greyed: false })).not.toContain("1 points");
    expect(stepTooltip({ tool: "box", name: "Mirror", count: 2, greyed: true })).toContain("Mirror delete, 2 points - rolled back");
    expect(stepTooltip({ tool: "box", name: null, count: 2, greyed: false })).toContain("double-click the name to rename");
  });

  test("UI-235 iconFor covers every tool and falls back to other", () => {
    const ids = ["box", "polygon", "cluster", "filter", "selection", "invalid"].map(iconFor);
    expect(ids).toEqual(["box", "polygon", "cluster", "filter", "other", "invalid"]);
    expect(iconFor("zzz")).toBe("other");
    expect(iconFor(undefined)).toBe("other");
  });
});

describe("marker geometry", () => {
  test("UI-236 slotFromX snaps, clamps and honours the scroll offset", () => {
    const pitch = CARD_W + GAP;
    expect(slotX(0)).toBe(PAD - GAP / 2);
    expect(slotX(2)).toBe(PAD + 2 * pitch - GAP / 2);
    for (let k = 0; k <= 3; k++) expect(slotFromX(slotX(k), 3)).toBe(k);
    expect(slotFromX(slotX(1) + pitch * 0.4, 3)).toBe(1);
    expect(slotFromX(slotX(1) + pitch * 0.6, 3)).toBe(2);
    expect(slotFromX(-500, 3)).toBe(0);
    expect(slotFromX(99999, 3)).toBe(3);
    expect(slotFromX(slotX(2), 0)).toBe(0);
    // content x = client x - scroller left + scrollLeft
    expect(slotFromX(100 - 40 + 300, 10)).toBe(slotFromX(360, 10));
  });

  test("UI-1238 chip geometry per breakpoint: CARD_W is 112 and CARD_W_WIDE 184; slotX, markerSlots, slotFromX and timelineView take the width and snap, clamp and size the track the same way (default CARD_W)", () => {
    expect(CARD_W).toBe(112);
    expect(CARD_W_WIDE).toBe(184);
    expect(slotX(2)).toBe(slotX(2, CARD_W));
    for (const W of [CARD_W, CARD_W_WIDE]) {
      const pitch = W + GAP;
      expect(slotX(3, W)).toBe(PAD + 3 * pitch - GAP / 2);
      for (let k = 0; k <= 3; k++) expect(slotFromX(slotX(k, W), 3, W)).toBe(k);
      expect(slotFromX(slotX(1, W) + pitch * 0.4, 3, W)).toBe(1);
      expect(slotFromX(slotX(1, W) + pitch * 0.6, 3, W)).toBe(2);
      expect(slotFromX(-500, 3, W)).toBe(0);
      expect(slotFromX(99999, 3, W)).toBe(3);
      expect(slotFromX(slotX(2, W), 0, W)).toBe(0);
      expect(markerSlots(3, W)).toEqual([0, 1, 2, 3].map((k) => slotX(k, W)));
      const v = timelineView(sess(2), emptyTimeline(), W);
      expect(v.trackWidth).toBe(PAD * 2 + 3 * pitch - GAP);
      expect(v.marker.x).toBe(slotX(2, W));
    }
  });

  test("UI-237 nextFocus clamps at both ends", () => {
    expect(nextFocus(1, "ArrowRight", 3)).toBe(2);
    expect(nextFocus(2, "ArrowRight", 3)).toBe(2);
    expect(nextFocus(0, "ArrowLeft", 3)).toBe(0);
    expect(nextFocus(2, "Home", 3)).toBe(0);
    expect(nextFocus(0, "End", 3)).toBe(2);
    expect(nextFocus(0, "x", 3)).toBe(0);
  });

  test("UI-238 sliderTarget: Left/Right one step, Home/End the ends, clamped, others null", () => {
    expect(sliderTarget("ArrowLeft", 2, 3)).toBe(1);
    expect(sliderTarget("ArrowLeft", 0, 3)).toBe(0);
    expect(sliderTarget("ArrowRight", 2, 3)).toBe(3);
    expect(sliderTarget("ArrowRight", 3, 3)).toBe(3);
    expect(sliderTarget("Home", 2, 3)).toBe(0);
    expect(sliderTarget("End", 0, 3)).toBe(3);
    expect(sliderTarget("a", 0, 3)).toBeNull();
  });
});

describe("highlight and rename state machine", () => {
  test("UI-239 click toggles, click another switches, Esc clears, Esc with nothing is a no-op", () => {
    let t = emptyTimeline();
    t = clickStep(t, 11);
    expect(t.highlight).toBe(11);
    t = clickStep(t, 12);
    expect(t.highlight).toBe(12);
    t = clickStep(t, 12);
    expect(t.highlight).toBeNull();
    t = clickStep(t, 11);
    expect(escapeKey(t).timeline.highlight).toBeNull();
    expect(escapeKey(t).used).toBe(true);
    const none = escapeKey(emptyTimeline());
    expect(none.used).toBe(false);
    expect(none.timeline).toEqual(emptyTimeline());
    expect(clearHighlight(clickStep(emptyTimeline(), 3)).highlight).toBeNull();
  });

  test("UI-239 rename: start, commit trims and clears to null, cancel keeps the old name", () => {
    let t = startRename(emptyTimeline(), 11);
    expect(t.renaming).toBe(11);
    let r = commitRename(t, "  Mirror  ");
    expect(r.name).toBe("Mirror");
    expect(r.timeline.renaming).toBeNull();
    t = startRename(emptyTimeline(), 11);
    r = commitRename(t, "   ");
    expect(r.name).toBe("");
    expect(cancelRename(t).renaming).toBeNull();
    expect(escapeKey(t).timeline.renaming).toBeNull();
    expect(escapeKey(t).used).toBe(true);
    // commit without a rename in progress changes nothing
    expect(commitRename(emptyTimeline(), "x").name).toBeNull();
  });

  test("UI-240 reconcile clears a vanished sid and keeps live ones", () => {
    const s = sess(3);
    let t = { ...emptyTimeline(), highlight: 11, hover: 12, renaming: 10, dragging: 2 };
    expect(reconcile(t, s)).toEqual(t);
    t = { ...t, highlight: 99, hover: 98, renaming: 97 };
    const r = reconcile(t, s);
    expect(r).toMatchObject({ highlight: null, hover: null, renaming: null });
    expect(reconcile(t, null)).toMatchObject({ highlight: null, hover: null, renaming: null, dragging: null });
  });

  test("UI-261 hover is set and cleared without touching the highlight", () => {
    const t = setHover(clickStep(emptyTimeline(), 11), 12);
    expect(t).toMatchObject({ highlight: 11, hover: 12 });
    expect(setHover(t, null).hover).toBeNull();
  });
});

describe("marker drag", () => {
  test("UI-262 one rollback on release with the snapped slot; Esc cancels; no move = no call", () => {
    let t = dragStart(emptyTimeline(), 3);
    expect(t.dragging).toBe(3);
    t = dragMove(t, 2);
    t = dragMove(t, 1);
    const end = dragEnd(t, 3);
    expect(end.rollbackTo).toBe(1);
    expect(end.timeline.dragging).toBeNull();
    expect(dragEnd(dragMove(dragStart(emptyTimeline(), 3), 3), 3).rollbackTo).toBeNull();
    expect(dragCancel(t).dragging).toBeNull();
    expect(dragEnd(emptyTimeline(), 3).rollbackTo).toBeNull();
    expect(escapeKey(t).used).toBe(true);
    expect(escapeKey(t).timeline.dragging).toBeNull();
  });
});

describe("keyboard", () => {
  test("UI-263 the strip owns Delete/Backspace/F2/Enter/Space on a step and the slider keys on the marker", () => {
    expect(stripKeyAction("Delete", "step")).toEqual({ type: "delete" });
    expect(stripKeyAction("Backspace", "step")).toEqual({ type: "delete" });
    expect(stripKeyAction("F2", "step")).toEqual({ type: "rename" });
    expect(stripKeyAction("Enter", "step")).toEqual({ type: "highlight" });
    expect(stripKeyAction(" ", "step")).toEqual({ type: "highlight" });
    expect(stripKeyAction("ArrowRight", "step")).toEqual({ type: "focus" });
    expect(stripKeyAction("Home", "step")).toEqual({ type: "focus" });
    expect(stripKeyAction("ArrowLeft", "marker")).toEqual({ type: "slider" });
    expect(stripKeyAction("Delete", "marker")).toBeNull();
    expect(stripKeyAction("Enter", "marker")).toBeNull();
    expect(stripKeyAction("Delete", "input")).toBeNull();
    expect(stripKeyAction("a", "step")).toBeNull();
  });
});

describe("keys on the strip's own controls", () => {
  test("UI-281 Delete/Backspace on a step button removes its step, on the marker is swallowed, other keys are left alone", () => {
    expect(stripControlKey("Delete", "button")).toBe("delete");
    expect(stripControlKey("Backspace", "button")).toBe("delete");
    expect(stripControlKey("Delete", "marker")).toBe("swallow");
    expect(stripControlKey("Backspace", "marker")).toBe("swallow");
    expect(stripControlKey("Enter", "button")).toBeNull();
    expect(stripControlKey(" ", "button")).toBeNull();
    expect(stripControlKey("ArrowLeft", "marker")).toBeNull();
  });
});

describe("apply and delete confirmations", () => {
  test("UI-264 discardCount counts the rolled-back steps and the text is exact", () => {
    expect(discardCount(sess(3))).toBe(0);
    expect(discardCount(sess(1))).toBe(2);
    expect(discardCount(null)).toBe(0);
    expect(discardText(2)).toBe("Applying a new deletion discards the 2 rolled-back step(s) after the marker (they cannot be redone). Continue?");
    expect(deleteStepText("Box 1", 1234)).toBe(
      'Remove step "Box 1"? Its 1,234 points come back (or stay active if rolled back); later steps are kept. This cannot be undone. Continue?',
    );
  });
});

describe("view model and layer style", () => {
  test("UI-265 timelineView: cards, greyed class, marker slot and text, empty text", () => {
    const v = timelineView(sess(2), { ...emptyTimeline(), highlight: 11 });
    expect(v.empty).toBe(false);
    expect(v.cards.map((c) => [c.sid, c.greyed, c.highlighted])).toEqual([[10, false, false], [11, false, true], [12, true, false]]);
    expect(v.marker).toMatchObject({ slot: 2, max: 3, now: 2, valuetext: "After step 2 of 3", x: slotX(2) });
    expect(v.trackWidth).toBe(PAD * 2 + 3 * (CARD_W + GAP) - GAP);
    const e = timelineView(sess(0, []), emptyTimeline());
    expect(e.empty).toBe(true);
    expect(e.emptyText).toBe("No steps yet"); // Part 19 (UI-933): layer edits are steps too
    expect(e.cards).toEqual([]);
    expect(timelineView(null, emptyTimeline()).hidden).toBe(true);
    expect(timelineView(sess(0), emptyTimeline()).marker.valuetext).toBe("Before the first step (3 steps rolled back)");
  });

  test("UI-266 stepLayerStyle: null without a step, strong colour for the highlight, lighter for hover only", () => {
    expect(stepLayerStyle(emptyTimeline())).toBeNull();
    const strong = stepLayerStyle(clickStep(emptyTimeline(), 11))!;
    expect(strong.sid).toBe(11);
    expect(strong.colour).toBe(PALETTE.step);
    expect(strong.opacity).toBe(0.95);
    expect(strong.hover).toBe(false);
    expect(strong.sizeDelta).toBe(2);
    const light = stepLayerStyle(setHover(emptyTimeline(), 12))!;
    expect(light).toMatchObject({ sid: 12, hover: true, opacity: 0.7 });
    expect(light.colour).toBe(PALETTE.stepHover);
    expect(light.colour).not.toEqual(strong.colour);
    // hovering the highlighted step itself stays strong; hovering another previews that one
    expect(stepLayerStyle(setHover(clickStep(emptyTimeline(), 11), 11))!.hover).toBe(false);
    expect(stepLayerStyle(setHover(clickStep(emptyTimeline(), 11), 12))).toMatchObject({ sid: 12, hover: true });
    // distinct from every other palette colour
    for (const k of ["base", "selected", "protected", "protectedStrong", "slab", "deleted"] as const) expect(PALETTE.step).not.toEqual(PALETTE[k]);
  });
});

test("UI-280 reconcile with no session returns the very same empty state (the store subscriber must not loop)", () => {
  const t = emptyTimeline();
  expect(reconcile(t, null)).toBe(t);
  expect(reconcile({ ...t, highlight: 2 }, null)).toEqual(emptyTimeline());
});

// ---- Part 19: layer edits are timeline steps (UI-928..937)
const layerEntry = (i: number, count: number, extra: Partial<HistoryEntry> = {}): HistoryEntry => ({
  index: i,
  sid: i + 10,
  kind: "layer",
  tool: "layer",
  name: null,
  description: `New layer Floor, ${count.toLocaleString("en-US")} points`,
  count,
  shape: null,
  deletable: true,
  ...extra,
});
const layerSess = (entries: HistoryEntry[], cursor = entries.length) =>
  sessionFixture({ history: { entries, cursor, can_undo: cursor > 0, can_redo: cursor < entries.length } });

describe("layer steps", () => {
  test("UI-928 iconFor layer is layer and the strip has its own glyph", () => {
    expect(iconFor("layer")).toBe("layer");
    expect(iconFor("selection")).toBe("other");
    expect(STEP_GLYPH.layer).toBeTruthy();
    expect(STEP_GLYPH.layer).not.toBe(STEP_GLYPH.other);
  });

  test("UI-929 an unnamed layer step reads Layer edit N with the server description in its tooltip", () => {
    const v = stepsOf(layerSess([entry(0, "box", 5), layerEntry(1, 1234)], 1))[1];
    expect(v.label).toBe("Layer edit 2");
    expect(v.icon).toBe("layer");
    expect(v.tooltip).toBe("New layer Floor, 1,234 points - rolled back. Click to highlight; double-click the name to rename");
    // a description without the count gets it appended
    const w = stepsOf(layerSess([layerEntry(0, 3, { description: "Floor set to the selection: 2 in, 1 out" })]))[0];
    expect(w.tooltip).toBe("Floor set to the selection: 2 in, 1 out, 3 points. Click to highlight; double-click the name to rename");
  });

  test("UI-930 a named layer step uses its name; deletion tooltips are unchanged", () => {
    const v = stepsOf(layerSess([layerEntry(0, 1, { name: "Mine" })]))[0];
    expect(v.label).toBe("Mine");
    expect(v.tooltip).toBe("Mine, 1 point. Click to highlight; double-click the name to rename");
    expect(stepTooltip({ tool: "box", name: null, count: 2, greyed: false })).toBe(
      "Box delete, 2 points. Click to highlight; double-click the name to rename",
    );
  });

  test("UI-931 deleteLayerStepText is exact", () => {
    expect(deleteLayerStepText("Layer edit 2", 1234)).toBe(
      'Remove step "Layer edit 2"? Its 1,234 points go back to their earlier layer; later steps are kept. This cannot be undone. Continue?',
    );
  });

  test("UI-932 a step that is not deletable disables delete with the reason; a missing flag reads as deletable", () => {
    const [a, b, c] = stepsOf(layerSess([layerEntry(0, 1, { deletable: false }), layerEntry(1, 1), entry(2, "box", 1)]));
    expect(a.deletable).toBe(false);
    expect(b.deletable).toBe(true);
    expect(c.deletable).toBe(true); // UI-937: a deletion row has no deletable key
    expect(deleteState(a)).toEqual({
      enabled: false,
      title: "A later layer edit builds on this one; remove that one first",
    });
    expect(deleteState(b)).toEqual({ enabled: true, title: "Delete this step" });
  });
});
