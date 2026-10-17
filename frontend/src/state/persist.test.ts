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
    colour: { mode: "intensity", pointSize: 6 },
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
  expect(patch!.colour).toEqual({ mode: "intensity", pointSize: 6 });
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

test("UI-145 a restored page keeps the view but starts Replace, Displayed, no tool and default cluster limits", () => {
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
  expect(out.op).toBe("replace");
  expect(out.scope).toBe("displayed");
  expect(out.tool).toBe("none");
  expect(out.colour).toEqual({ mode: "flat", pointSize: 5 });
  expect(out.tools.cluster.maxPoints).toBe(fresh.tools.cluster.maxPoints);
  expect(out.tools.cluster.seed).toBeNull();
});
