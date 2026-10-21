import { describe, expect, it } from "vitest";
import { layerColourKey } from "../colour/key";
import { createAppStore } from "../state/app";
import type { AppState } from "../state/app";
import { sessionFixture } from "../testing/fixtures";
import { orbit } from "../view/camera";
import { colourRegion, protectionIntervals } from "./band";
import { DEFAULT_FLOOR_T, type ProtectionModel, emptyProtection, floorFromPick, setGlobal } from "./protection";

const model = (over: Partial<ProtectionModel> = {}): ProtectionModel => ({ ...emptyProtection(), ...over });
const on = (min: number, max: number) => ({ enabled: true, min, max });

describe("protection intervals for the band and the strong colour", () => {
  it("UI-212 inherit uses the global slab, add_local adds the local one, override uses only the local one", () => {
    const g = on(1, 2);
    expect(protectionIntervals(model({ global: g }))).toEqual([{ min: 1, max: 2 }]);
    expect(protectionIntervals(model({ global: g, mode: "add_local", local: { min: 5, max: 6 } }))).toEqual([{ min: 1, max: 2 }, { min: 5, max: 6 }]);
    expect(protectionIntervals(model({ global: g, mode: "override", local: { min: 5, max: 6 } }))).toEqual([{ min: 5, max: 6 }]);
  });

  it("UI-212 a disabled global slab and a missing local interval give nothing", () => {
    expect(protectionIntervals(model())).toEqual([]);
    expect(protectionIntervals(model({ global: on(1, 2), mode: "override", local: null }))).toEqual([]);
    expect(protectionIntervals(model({ mode: "add_local", local: { min: 5, max: 6 } }))).toEqual([{ min: 5, max: 6 }]);
  });
});

describe("colour key", () => {
  const base = (): AppState => {
    const st = createAppStore();
    st.set({ session: sessionFixture() });
    st.update((s) => ({ ...s, tools: { ...s.tools, protection: model({ global: on(1, 2) }) } }));
    return st.get();
  };

  it("UI-213 the colour region exists only while the section is open and an interval is on", () => {
    const s = base();
    expect(colourRegion(s)).toEqual({ intervals: [{ min: 1, max: 2 }] });
    expect(colourRegion({ ...s, floorPanelOpen: false })).toBeNull();
    expect(colourRegion({ ...s, tools: { ...s.tools, protection: model() } })).toBeNull();
    expect(colourRegion({ ...s, session: null })).toBeNull();
  });

  it("UI-213 the key changes with the section flag and the intervals, not with the camera", () => {
    const s = base();
    const k = layerColourKey(s, true);
    expect(layerColourKey({ ...s, floorPanelOpen: false }, true)).not.toBe(k);
    expect(layerColourKey({ ...s, tools: { ...s.tools, protection: model({ global: on(1, 3) }) } }, true)).not.toBe(k);
    expect(layerColourKey({ ...s, camera: orbit(s.camera, 0.4, 0.1) }, true)).toBe(k);
    expect(layerColourKey({ ...s, colour: { ...s.colour, mode: "flat" } }, true)).not.toBe(k);
  });

  it("UI-213 a layer that never shows the region ignores it, and a collapsed section equals no protection", () => {
    const s = base();
    const none = { ...s, tools: { ...s.tools, protection: model() } };
    expect(layerColourKey(s, false)).toBe(layerColourKey(none, false));
    expect(layerColourKey({ ...s, floorPanelOpen: false }, true)).toBe(layerColourKey(none, true));
  });
});

describe("pick floor and the band", () => {
  it("UI-214 pick floor still gives z -/+ the floor thickness and an edge drag never changes it", () => {
    const st = createAppStore();
    const r = floorFromPick("edited", 3, st.get().floorT);
    expect(r).toEqual({ ok: true, min: 3 - DEFAULT_FLOOR_T, max: 3 + DEFAULT_FLOOR_T });
    const m = setGlobal(model(), { enabled: true, min: r.ok ? r.min : 0, max: r.ok ? r.max : 0 });
    expect(m.ok).toBe(true);
    expect(st.get().floorT).toBe(DEFAULT_FLOOR_T);
  });
});
