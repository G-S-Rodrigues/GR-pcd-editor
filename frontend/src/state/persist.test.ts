import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createAppStore } from "./app";
import { applyClientPatch, createPersister, restoreClientState, serialiseClientState } from "./persist";
import { sessionFixture } from "../testing/fixtures";
import { setCompare } from "../compare/model";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test("UI-91 serialise: versioned, JSON-safe and far below 1 MiB", () => {
  const store = createAppStore();
  const c = serialiseClientState(store.get());
  expect(c.v).toBe(1);
  expect(Object.keys(c).sort()).toEqual(["camera", "colour", "comparison", "pivot", "pointSize", "tools", "ui", "unit", "v"].sort());
  expect(Object.keys(c.tools as object).sort()).toEqual(["box", "cluster", "polygon"]);
  expect(JSON.stringify(c).length).toBeLessThan(1024 * 1024);
  expect(JSON.parse(JSON.stringify(c))).toEqual(c);
});

test("UI-91 debounced PUT one second after the last change, none for an unchanged state", () => {
  const store = createAppStore();
  const put = vi.fn(async (_s: Record<string, unknown>) => undefined);
  store.set({ session: sessionFixture() });
  const p = createPersister(store, put, { ms: 1000, dragging: () => false });
  store.set({ colour: { mode: "flat", pointSize: 3 } });
  vi.advanceTimersByTime(900);
  store.set({ colour: { mode: "flat", pointSize: 5 } });
  vi.advanceTimersByTime(900);
  expect(put).not.toHaveBeenCalled();
  vi.advanceTimersByTime(200);
  expect(put).toHaveBeenCalledTimes(1);
  expect(put.mock.calls[0][0]).toMatchObject({ v: 1, pointSize: 5, colour: "flat" });
  store.set({ notices: [] }); // not client state
  vi.advanceTimersByTime(5000);
  expect(put).toHaveBeenCalledTimes(1);
  p.dispose();
});

test("UI-91 nothing is sent without a session and never during a drag", () => {
  const store = createAppStore();
  const put = vi.fn(async (_s: Record<string, unknown>) => undefined);
  let drag = true;
  createPersister(store, put, { ms: 1000, dragging: () => drag });
  store.set({ colour: { mode: "flat", pointSize: 4 } });
  vi.advanceTimersByTime(3000);
  expect(put).not.toHaveBeenCalled(); // no session
  store.set({ session: sessionFixture() });
  store.set({ colour: { mode: "flat", pointSize: 5 } });
  vi.advanceTimersByTime(3000);
  expect(put).not.toHaveBeenCalled(); // dragging
  drag = false;
  vi.advanceTimersByTime(1100);
  expect(put).toHaveBeenCalledTimes(1);
});

test("UI-92 restore round trip: camera, colouring, comparison and tool geometry exact", () => {
  const a = createAppStore();
  a.update((s) => ({
    ...s,
    camera: { ...s.camera, target: [1e6 + 0.123456789, -5, 2.5], distance: 42, ortho: true },
    colour: { mode: "viridis", pointSize: 6 },
    tools: {
      ...s.tools,
      box: { center: [1e6 + 0.5, 2, 3], dimensions: [4, 5, 6], quat: [0, 0, 0.6, 0.8], mode: "outside" },
      polygon: { ...s.tools.polygon, phase: "closed", vertices: [[0, 0], [4, 0], [4, 4]], zMin: -1, zMax: 7 },
    },
  }));
  setCompare(a, "overlay");
  a.set({ overlayOpacity: 0.6 });
  const saved = JSON.parse(JSON.stringify(serialiseClientState(a.get())));
  const patch = restoreClientState(saved);
  expect(patch).not.toBeNull();
  expect(patch!.camera).toEqual(a.get().camera);
  expect(patch!.colour).toEqual({ mode: "viridis", pointSize: 6 });
  expect(patch!.compare).toBe("overlay");
  expect(patch!.overlayOpacity).toBe(0.6);
  expect(patch!.tools!.box).toEqual(a.get().tools.box);
  expect(patch!.tools!.polygon).toEqual(a.get().tools.polygon);
});

test("UI-92 unknown version, malformed or hostile content gives defaults without throwing", () => {
  expect(restoreClientState({})).toBeNull();
  expect(restoreClientState({ v: 2, camera: {} })).toBeNull();
  expect(restoreClientState("nope")).toBeNull();
  expect(restoreClientState(null)).toBeNull();
  const bad = restoreClientState({ v: 1, camera: { target: ["a"] }, colour: 7, tools: { box: { center: [1] } }, comparison: { mode: "zzz" } });
  expect(bad?.camera).toBeUndefined();
  expect(bad?.colour).toBeUndefined();
  expect(bad?.tools).toBeUndefined();
  expect(bad?.compare).toBeUndefined();
});

test("UI-92 filters and protection are not part of client state", () => {
  const s = JSON.stringify(serialiseClientState(createAppStore().get()));
  expect(s).not.toMatch(/filters|protection/);
});

test("UI-92 applying a restored patch updates camera, colour, comparison and tools but not filters", () => {
  const a = createAppStore();
  a.update((s) => ({ ...s, colour: { mode: "flat", pointSize: 7 }, scope: "active", budget: 123456 }));
  setCompare(a, "split");
  const patch = restoreClientState(JSON.parse(JSON.stringify(serialiseClientState(a.get()))))!;
  const b = createAppStore();
  const filters = b.get().tools.filters;
  const out = applyClientPatch(b.get(), patch);
  expect(out.colour).toEqual({ mode: "flat", pointSize: 7 });
  expect(out.compare).toBe("split");
  expect(out.renderMode).toBe("original");
  expect(out.scope).toBe("displayed"); // 7b-2: scope is session-transient (plan decision 9)
  expect(out.budget).toBe(123456);
  expect(out.tools.filters).toBe(filters);
});

test("UI-145 a restored page keeps the view but starts Add, Displayed, no tool and default cluster limits", () => {
  const a = createAppStore();
  a.update((s) => ({
    ...s,
    op: "intersect",
    scope: "active",
    tool: "cluster",
    colour: { mode: "flat", pointSize: 5 },
    tools: { ...s.tools, cluster: { ...s.tools.cluster, maxPoints: 1234, radius: 2, seed: { id: 3, point: [1, 2, 3] } } },
  }));
  const saved = JSON.parse(JSON.stringify(serialiseClientState(a.get())));
  expect(saved.ui.op).toBeUndefined();
  expect(saved.ui.scope).toBeUndefined();
  const patch = restoreClientState(saved)!;
  expect((patch as Record<string, unknown>).op).toBeUndefined();
  expect((patch as Record<string, unknown>).scope).toBeUndefined();
  const fresh = createAppStore().get();
  const out = applyClientPatch(fresh, patch);
  expect(out.op).toBe("add"); // a saved or absent op restores as Add (Replace is gone from the UI)
  expect(out.scope).toBe("displayed");
  expect(out.tool).toBe("none");
  expect(out.colour).toEqual({ mode: "flat", pointSize: 5 });
  expect(out.tools.cluster.maxPoints).toBe(fresh.tools.cluster.maxPoints);
  expect(out.tools.cluster.seed).toBeNull();
});

test("UI-276 the timeline highlight and hover are view-only: not in the saved client state", () => {
  const a = createAppStore();
  a.update((s) => ({ ...s, timeline: { highlight: 3, hover: 2, renaming: null, dragging: null } }));
  const s = JSON.stringify(serialiseClientState(a.get()));
  expect(s).not.toMatch(/timeline|highlight|stepRender/);
});

test("UI-287 flush sends a change that is still inside the debounce window and waits for the PUT; the timer then sends nothing more", async () => {
  const store = createAppStore();
  let done = false;
  const put = vi.fn(async (_s: Record<string, unknown>) => {
    await new Promise((r) => setTimeout(r, 50));
    done = true;
  });
  store.set({ session: sessionFixture() });
  const p = createPersister(store, put, { ms: 1000, dragging: () => false });
  store.set({ notices: [] }); // the first update only records the session's state
  store.set({ colour: { mode: "flat", pointSize: 7 } });
  vi.advanceTimersByTime(200); // a Save 200 ms after the change
  expect(put).not.toHaveBeenCalled();
  const flushed = p.flush();
  expect(put).toHaveBeenCalledTimes(1);
  expect(put.mock.calls[0][0]).toMatchObject({ pointSize: 7 });
  expect(done).toBe(false);
  await vi.advanceTimersByTimeAsync(60);
  await flushed;
  expect(done).toBe(true);
  await vi.advanceTimersByTimeAsync(5000);
  expect(put).toHaveBeenCalledTimes(1);
  await p.flush(); // nothing changed: nothing sent
  expect(put).toHaveBeenCalledTimes(1);
  p.dispose();
});

test("UI-365 saved colour modes migrate: height, rgb and intensity open as turbo; the new ids stay; junk drops the colour patch", () => {
  const colourOf = (c: unknown) => restoreClientState({ v: 1, colour: c, pointSize: 4 })?.colour;
  for (const old of ["height", "rgb", "intensity"]) expect(colourOf(old), old).toEqual({ mode: "turbo", pointSize: 4 });
  for (const m of ["turbo", "viridis", "flat"]) expect(colourOf(m), m).toEqual({ mode: m, pointSize: 4 });
  for (const junk of ["normals-x", "", 3, null, {}]) expect(colourOf(junk), String(junk)).toBeUndefined();
  const s = createAppStore();
  const saved = JSON.parse(JSON.stringify(serialiseClientState(s.get())));
  expect(saved.colour).toBe("turbo");
  expect(JSON.stringify(saved)).not.toMatch(/filters|protection/);
});

test("UI-725 selected colour: saved only when not orange, restored for a known id, hostile values give the default", () => {
  const a = createAppStore();
  expect((serialiseClientState(a.get()).ui as Record<string, unknown>).selectedColour).toBeUndefined();
  a.set({ selectedColour: "magenta" });
  const saved = JSON.parse(JSON.stringify(serialiseClientState(a.get())));
  expect(saved.ui.selectedColour).toBe("magenta");
  const patch = restoreClientState(saved);
  expect(patch?.selectedColour).toBe("magenta");
  const b = createAppStore();
  expect(applyClientPatch(b.get(), patch!).selectedColour).toBe("magenta");
  for (const bad of ["pink", 7, { id: "lime" }, null, "orange"]) {
    const p = restoreClientState({ v: 1, ui: { selectedColour: bad } });
    expect(p?.selectedColour, String(bad)).toBeUndefined();
    expect(applyClientPatch(b.get(), p!).selectedColour).toBe("orange");
  }
  expect(JSON.stringify(serialiseClientState(a.get()))).not.toMatch(/filters|protection/);
});

test("UI-857 a saved Layers colour mode restores as Layers with layers and as Turbo on a session without them", () => {
  const saved = createAppStore();
  saved.update((s) => ({ ...s, colour: { ...s.colour, mode: "layers" } }));
  const patch = restoreClientState(JSON.parse(JSON.stringify(serialiseClientState(saved.get()))))!;
  expect(patch.colour?.mode).toBe("layers");
  const withLayers = createAppStore();
  withLayers.set({ session: sessionFixture({ layers: [{ id: 1, name: "A", colour: 0, visible: true, count: 1, bounds: null }] }) });
  expect(applyClientPatch(withLayers.get(), patch).colour.mode).toBe("layers");
  const without = createAppStore();
  without.set({ session: sessionFixture() });
  expect(applyClientPatch(without.get(), patch).colour.mode).toBe("turbo");
});

test("UI-866 the layer panel state (the layer being edited, the chosen row) is never in the saved client state", () => {
  const store = createAppStore();
  store.set({ layerUi: { editing: 3, active: 3 } });
  const json = JSON.stringify(serialiseClientState(store.get()));
  expect(json).not.toMatch(/layerUi|"editing":3|"active":3/);
  const patch = restoreClientState(JSON.parse(json))!;
  expect(applyClientPatch(createAppStore().get(), patch).layerUi).toEqual({ editing: null, active: null });
});

test("UI-886 a fresh session starts Link distance 0.3 and Max points 500; a saved radius still wins and Max points is always the default", () => {
  const fresh = createAppStore().get();
  expect(fresh.tools.cluster.radius).toBe(0.3);
  expect(fresh.tools.cluster.maxPoints).toBe(500);
  const a = createAppStore();
  a.update((s) => ({ ...s, tools: { ...s.tools, cluster: { ...s.tools.cluster, radius: 0.5, maxPoints: 99 } } }));
  const saved = JSON.parse(JSON.stringify(serialiseClientState(a.get())));
  const out = applyClientPatch(fresh, restoreClientState(saved)!);
  expect(out.tools.cluster.radius).toBe(0.5);
  expect(out.tools.cluster.maxPoints).toBe(500);
});

test("UI-967 a restored page does not restore the plane list, the chosen plane or the Planes and Thin tools", () => {
  const a = createAppStore();
  a.update((s) => ({
    ...s,
    tool: "plane",
    planes: { ...s.planes, list: [], chosen: { normal: [0, 0, 1], d: 1, thickness: 0.03 }, chosenRow: 0 },
    tools: { ...s.tools, plane: { ...s.tools.plane, distance: 0.5 }, thin: { ...s.tools.thin, method: "voxel" } },
  }));
  const saved = JSON.parse(JSON.stringify(serialiseClientState(a.get())));
  const patch = restoreClientState(saved)!;
  expect(patch.tools).not.toHaveProperty("plane");
  expect(patch.tools).not.toHaveProperty("thin");
  expect(patch).not.toHaveProperty("planes");
  const b = createAppStore();
  b.update((s) => applyClientPatch(s, patch));
  expect(b.get().tool).toBe("none");
  expect(b.get().planes.list).toBeNull();
  expect(b.get().planes.chosen).toBeNull();
  expect(b.get().tools.plane.distance).toBe(0.03);
  expect(b.get().tools.thin.method).toBe("duplicates");
});

test("UI-968 the saved client state holds only the existing keys: no plane or thin model, no plane numbers", () => {
  const a = createAppStore();
  a.update((s) => ({
    ...s,
    planes: { ...s.planes, list: [], chosen: { normal: [0, 0, 1], d: 1.2345678, thickness: 0.03 } },
    tools: { ...s.tools, plane: { ...s.tools.plane, distance: 0.4321 }, thin: { ...s.tools.thin, edge: 0.7654321 } },
  }));
  const c = serialiseClientState(a.get());
  expect(Object.keys(c).sort()).toEqual(["camera", "colour", "comparison", "pivot", "pointSize", "tools", "ui", "unit", "v"].sort());
  expect(Object.keys(c.tools as object).sort()).toEqual(["box", "cluster", "polygon"]);
  const text = JSON.stringify(c);
  for (const needle of ["1.2345678", "0.4321", "0.7654321", "planes", "thin"]) expect(text).not.toContain(needle);
});
