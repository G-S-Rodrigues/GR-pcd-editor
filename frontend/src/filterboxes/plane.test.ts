import { describe, expect, it } from "vitest";
import { createAppStore } from "../state/app";
import type { AppState } from "../state/app";
import { sessionFixture } from "../testing/fixtures";
import type { Vec3 } from "../state/types";
import { defaultCamera, orbit } from "../view/camera";
import { pxPerUnit } from "../view/pointsize";
import { applyPreset } from "../view/presets";
import { ARROW_PX, PLANE_PX, filterPlanes } from "./plane";

const H = 600;
const base = (over: Partial<AppState> = {}, z = { enabled: true, min: 2, max: 8 }): AppState => {
  const st = createAppStore();
  st.set({ session: sessionFixture(), camera: { ...defaultCamera(), target: [5, 5, 5] as Vec3, distance: 20 }, ...over });
  st.update((s) => ({ ...s, tools: { ...s.tools, filters: { ...s.tools.filters, z } } }));
  return st.get();
};
const keys = (s: AppState) => filterPlanes(s, H).map((p) => p.key).sort();

describe("filter plane model", () => {
  it("UI-202 a plane shows for each active side, expanded and in the edited view only", () => {
    expect(keys(base())).toEqual(["z-max", "z-min"]);
    expect(keys(base({}, { enabled: false, min: 0, max: 10 }))).toEqual([]);
    expect(keys(base({}, { enabled: true, min: 0, max: 8 }))).toEqual(["z-max"]); // min is at the bound: inactive
    const collapsed = base();
    expect(keys({ ...collapsed, filterUi: { ...collapsed.filterUi, collapsed: { "z-max": true } } })).toEqual(["z-min"]);
    for (const compare of ["original", "overlay", "split"] as const) expect(keys(base({ compare }))).toEqual([]);
  });

  it("UI-202 an inactive side shows its plane only while interacting with it (and not when collapsed)", () => {
    const s = base({}, { enabled: false, min: 0, max: 10 });
    expect(keys({ ...s, filterUi: { ...s.filterUi, interacting: "x-max" } })).toEqual(["x-max"]);
    expect(keys({ ...s, filterUi: { collapsed: { "x-max": true }, interacting: "x-max" } })).toEqual([]);
  });

  it("UI-202 the plane sits at the cut, is centred on the target clamped into the active bounds, and is not bbox-filling", () => {
    const s = base({ camera: { ...defaultCamera(), target: [50, -3, 5] as Vec3, distance: 20 } });
    const p = filterPlanes(s, H).find((q) => q.key === "z-max")!;
    expect(p.centre).toEqual([10, 0, 8]); // x, y clamped into [0,10]; z = the cut
    expect(p.corners).toHaveLength(4);
    for (const c of p.corners) expect(c[2]).toBe(8);
    const ppu = pxPerUnit(s.camera, H);
    const side = Math.abs(p.corners[0][0] - p.corners[1][0]) + Math.abs(p.corners[0][1] - p.corners[1][1]);
    expect(side).toBeCloseTo(Math.min(PLANE_PX / ppu, 0.3 * 10), 9);
    expect(side).toBeLessThanOrEqual(3 + 1e-9);
  });

  it("UI-202 the size is screen-constant below the cap", () => {
    const wide = base({ session: sessionFixture({ active_bounds: { min: [0, 0, 0], max: [1000, 1000, 1000] }, bounds: { min: [0, 0, 0], max: [1000, 1000, 1000] } }) });
    const p = filterPlanes(wide, H).find((q) => q.key === "z-max")!;
    const ppu = pxPerUnit(wide.camera, H);
    expect(Math.hypot(p.corners[1][0] - p.corners[0][0], p.corners[1][1] - p.corners[0][1]) * ppu).toBeCloseTo(PLANE_PX, 6);
  });

  it("UI-202 the arrow points to the hidden side and is ARROW_PX long on screen", () => {
    const s = base();
    const ppu = pxPerUnit(s.camera, H);
    const lo = filterPlanes(s, H).find((q) => q.key === "z-min")!;
    const hi = filterPlanes(s, H).find((q) => q.key === "z-max")!;
    expect(hi.tip[2] - hi.base[2]).toBeCloseTo(ARROW_PX / ppu, 9);
    expect(lo.tip[2] - lo.base[2]).toBeCloseTo(-ARROW_PX / ppu, 9);
    expect(hi.base).toEqual(hi.centre);
  });

  it("UI-202 slice view and camera do not change which planes exist", () => {
    const s = base();
    const sliced = { ...s, slice: { ...s.slice, enabled: true, centre: 5, thickness: 0.1 } };
    expect(keys(sliced)).toEqual(keys(s));
    const turned = { ...s, camera: orbit(applyPreset(s.camera, "front"), 0.5, 0.2) };
    expect(keys(turned)).toEqual(keys(s));
  });

  it("UI-202 no session, no planes", () => {
    const s = createAppStore().get();
    expect(filterPlanes(s, H)).toEqual([]);
  });
});
