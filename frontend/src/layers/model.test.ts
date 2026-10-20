import { describe, expect, it } from "vitest";
import { renderCacheKey } from "../compare/model";
import { initialState } from "../state/app";
import { sessionFixture } from "../testing/fixtures";
import {
  AT_LIMIT,
  HIDDEN_LAYER_NAME,
  LAYER_COLOURS,
  MAIN_COLOUR,
  NO_SELECTION,
  PICK_LAYER,
  SHOW_FIRST,
  editingText,
  exportItems,
  exportedCount,
  findLayer,
  hiddenExportNote,
  hiddenLayer,
  hiddenPointCount,
  layerBoxShape,
  layerColour,
  layerButtons,
  layerModeFix,
  layerRows,
  layersForRequest,
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

  it("UI-517 (moved from view/hidden.test.ts, text per 15b) the export note names the hidden points and is empty when none are hidden", () => {
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

describe("layer panel and export model", () => {
  const withLayers = (over: Record<string, unknown> = {}) => {
    const s = initialState();
    return {
      ...s,
      session: sessionFixture({
        selection: { count: 4, ops: [] },
        layers: [layer({ id: 1, name: "Floor", count: 30 }), layer({ id: 2, name: "Wall", count: 20, visible: false })],
        counts: { ...sessionFixture().counts, main: 50, hidden: 20, active: 100, invalid_active: 3 },
      }),
      ...over,
    };
  };

  it("UI-821 layerButtons names the first reason each button is inactive, and null when it works", () => {
    expect(layerButtons({ ...initialState(), session: null }).create).toBe("No file is open");
    expect(layerButtons(withLayers({ compare: "original" })).create).toBe("Return to the edited view first");
    expect(layerButtons(withLayers({ draft: true })).create).toBe("Commit or discard the draft first");
    expect(layerButtons(withLayers({ session: sessionFixture({ selection: { count: 0, ops: [] }, layers: [layer()] }) })).assign).toBe(NO_SELECTION);
    const b = layerButtons(withLayers());
    expect(b.create).toBeNull();
    expect(b.assign).toBe(PICK_LAYER); // no row chosen yet
    expect(b.release).toBeNull();
    const c = layerButtons(withLayers({ layerUi: { editing: null, active: 2 } }));
    expect(c.assign).toBeNull();
    expect(c.active?.name).toBe("Wall");
    expect(layerButtons(withLayers({ layerUi: { editing: null, active: 9 } })).assign).toBe(PICK_LAYER);
    const none = sessionFixture({ selection: { count: 4, ops: [] } });
    expect(layerButtons(withLayers({ session: none })).release).toBe("There are no layers yet");
    const full = sessionFixture({ selection: { count: 4, ops: [] }, layers: Array.from({ length: 32 }, (_, i) => layer({ id: i + 1 })) });
    expect(layerButtons(withLayers({ session: full })).create).toBe(AT_LIMIT);
  });

  it("UI-822 the export picker lists Main first, marks hidden layers, and is empty without layers", () => {
    expect(exportItems(sessionFixture())).toEqual([]);
    expect(exportItems(null)).toEqual([]);
    const items = exportItems(withLayers().session);
    expect(items.map((i) => i.id)).toEqual([0, 1, 2]);
    expect(items.map((i) => i.label)).toEqual(["Main (50)", "Floor (30)", "Wall (20) (hidden, still exported)"]);
  });

  it("UI-823 layersForRequest is null unless a strict subset is ticked, so the default request does not change", () => {
    const s = withLayers().session;
    expect(layersForRequest(s, new Set([0, 1, 2]))).toBeNull();
    expect(layersForRequest(s, new Set([1, 2]))).toEqual([1, 2]);
    expect(layersForRequest(s, new Set())).toEqual([]);
    expect(layersForRequest(sessionFixture(), new Set())).toBeNull();
  });

  it("UI-824 exportedCount is the exact sum of the ticked layers, invalid points riding with main", () => {
    const s = withLayers().session;
    expect(exportedCount(s, new Set([1]))).toBe(30);
    expect(exportedCount(s, new Set([0, 2]))).toBe(50 + 20 + 3);
    expect(exportedCount(s, new Set([0, 1, 2]))).toBe(103);
    expect(exportedCount(sessionFixture(), new Set())).toBe(900);
  });
});

describe("colour by layer fallback", () => {
  it("UI-856 layerModeFix turns Layers back into Turbo when the session has no layers, and leaves every other case alone", () => {
    const s = initialState();
    const on = { ...s, colour: { ...s.colour, mode: "layers" as const } };
    expect(layerModeFix({ ...on, session: sessionFixture() })?.mode).toBe("turbo");
    expect(layerModeFix({ ...on, session: null })?.mode).toBe("turbo");
    expect(layerModeFix({ ...on, session: sessionFixture({ layers: [layer()] }) })).toBeNull();
    expect(layerModeFix({ ...s, session: sessionFixture() })).toBeNull();
  });
});
