import { describe, expect, it } from "vitest";
import { renderCacheKey } from "../compare/model";
import { initialState } from "../state/app";
import { sessionFixture } from "../testing/fixtures";
import {
  HIDDEN_LAYER_NAME,
  LAYER_COLOURS,
  MAIN_COLOUR,
  SHOW_FIRST,
  editingText,
  findLayer,
  hiddenExportNote,
  hiddenLayer,
  hiddenPointCount,
  layerBoxShape,
  layerColour,
  layerRows,
  stealConfirmText,
} from "./model";
import { MIN_EXTENT } from "../tools/box/model";
import type { Layer } from "../state/types";

const layer = (over: Partial<Layer> = {}): Layer => ({ id: 1, name: "Floor", colour: 0, visible: true, count: 100, bounds: null, ...over });

describe("layer model", () => {
  it("UI-803 the palette has 16 distinct colours and none is the main grey", () => {
    expect(LAYER_COLOURS).toHaveLength(16);
    expect(new Set(LAYER_COLOURS).size).toBe(16);
    expect(LAYER_COLOURS).not.toContain(MAIN_COLOUR);
    expect(layerColour(3)).toBe(LAYER_COLOURS[3]);
    expect(layerColour(19)).toBe(LAYER_COLOURS[3]);
  });

  it("UI-804 hiddenPointCount reads counts.hidden and is 0 without a session or layers", () => {
    expect(hiddenPointCount(null)).toBe(0);
    expect(hiddenPointCount(sessionFixture())).toBe(0);
    const s = sessionFixture({ layers: [layer({ visible: false })] });
    s.counts.hidden = 100;
    expect(hiddenPointCount(s)).toBe(100);
  });

  it("UI-805 rows carry the colour, label, eye name and the Select reason", () => {
    const s = sessionFixture({ layers: [layer({ count: 1234 }), layer({ id: 2, name: "Ghosts", colour: 1, visible: false, count: 5 }), layer({ id: 3, name: "Empty", count: 0 })] });
    const rows = layerRows(s);
    expect(rows.map((r) => r.label)).toEqual(["Floor (1,234)", "Ghosts (5)", "Empty (0)"]);
    expect(rows[0]).toMatchObject({ colour: LAYER_COLOURS[0], eyeLabel: "Hide layer Floor", selectDisabled: null });
    expect(rows[1]).toMatchObject({ colour: LAYER_COLOURS[1], eyeLabel: "Show layer Ghosts", selectDisabled: SHOW_FIRST });
    expect(rows[2].selectDisabled).toBe("The layer has no points");
    expect(layerRows(null)).toEqual([]);
  });

  it("UI-806 lookups find a layer by id and the Hidden layer by its exact name", () => {
    const s = sessionFixture({ layers: [layer(), layer({ id: 2, name: HIDDEN_LAYER_NAME }), layer({ id: 3, name: "hidden" })] });
    expect(findLayer(s, 2)?.name).toBe("Hidden");
    expect(findLayer(s, 9)).toBeNull();
    expect(hiddenLayer(s)?.id).toBe(2);
    expect(hiddenLayer(sessionFixture())).toBeNull();
  });

  it("UI-807 the steal confirm names the exact count and layer, and is null when nothing is taken", () => {
    expect(stealConfirmText({ moved: 10, from_other_layers: 1200, released: 0 }, "Floor")).toBe("Move 1,200 points out of other layers into Floor?");
    expect(stealConfirmText({ moved: 10, from_other_layers: 0, released: 0 }, "Floor")).toBeNull();
    expect(stealConfirmText(null, "Floor")).toBeNull();
  });

  it("UI-808 the export note names the hidden points and is empty when none are hidden", () => {
    expect(hiddenExportNote(0)).toBe("");
    expect(hiddenExportNote(1234)).toBe("1,234 hidden points are exported too (hidden layers are exported unless unticked)");
  });

  it("UI-809 the edit box is the member bounds with every side at least MIN_EXTENT", () => {
    const shape = layerBoxShape({ min: [0, 2, 4], max: [2, 2, 10] });
    expect(shape).toEqual({ type: "box", center: [1, 2, 7], dimensions: [2, MIN_EXTENT, 6], rpy_deg: [0, 0, 0], mode: "inside" });
    expect(editingText("Floor", 1000, 2500)).toBe("Editing layer Floor: 1,000 members, the box selects 2,500");
  });

  it("UI-802 a layer op bumps the params revision, so the render cache key changes with it", () => {
    const a = { ...initialState(), session: sessionFixture() };
    const bumped = sessionFixture({ revision: { cloud: 3, params: 5 } });
    expect(renderCacheKey(a, "edited")).not.toBe(renderCacheKey({ ...a, session: bumped }, "edited"));
  });
});
