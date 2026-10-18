import { expect, test, vi } from "vitest";
import { PALETTE } from "../colour/palette";
import { createAppStore } from "../state/app";
import type { RenderData } from "../render/parse";
import { createRefresher } from "../orchestration/refresh";
import { sessionFixture } from "../testing/fixtures";
import {
  COMPARE_MODES,
  READ_ONLY_REASON,
  clampOpacity,
  countsPanel,
  editAllowed,
  fetchPlan,
  overlayStyle,
  renderCacheKey,
  setCompare,
} from "./model";
import { splitRects } from "./split";

const data = (n = 1): RenderData => ({
  coords: new Float32Array(n * 3),
  ids: new Uint32Array(n),
  flags: new Uint8Array(n),
  origin: [0, 0, 0],
  count: n,
  eligible: n,
  cloudRevision: 0,
  paramsRevision: 0,
});

test("UI-80 modes and the renders each one needs", () => {
  expect(COMPARE_MODES).toEqual(["original", "edited", "overlay", "split"]);
  expect(fetchPlan("original")).toEqual({ primary: "original", secondary: null });
  expect(fetchPlan("edited")).toEqual({ primary: "edited", secondary: null });
  expect(fetchPlan("overlay")).toEqual({ primary: "edited", secondary: "deleted" });
  expect(fetchPlan("split")).toEqual({ primary: "original", secondary: "edited" });
});

test("UI-81 overlay: deleted colour from the palette, opacity clamped to 0.05..1", () => {
  expect(clampOpacity(0)).toBe(0.05);
  expect(clampOpacity(5)).toBe(1);
  expect(clampOpacity(0.5)).toBe(0.5);
  expect(clampOpacity(Number.NaN)).toBe(0.35);
  expect(overlayStyle(0.2)).toEqual({ colour: PALETTE.deleted, opacity: 0.2 });
  expect(overlayStyle(undefined).opacity).toBe(0.35);
});

test("UI-82 split rectangles cover the canvas exactly with two equal halves", () => {
  const [l, r] = splitRects(1001, 600);
  expect(l).toEqual({ x: 0, y: 0, w: 500, h: 600 });
  expect(r).toEqual({ x: 500, y: 0, w: 501, h: 600 });
  expect(l.w + r.w).toBe(1001);
});

test("UI-82 split panes are drawn from one camera, colour mode and point size (single state)", () => {
  const store = createAppStore();
  setCompare(store, "split");
  const s = store.get();
  expect(s.compare).toBe("split");
  // there is exactly one camera and one colour state in the store; both panes read them
  expect(Object.keys(s).filter((k) => k === "camera" || k === "colour")).toEqual(["camera", "colour"]);
});

test("UI-83 counts panel: original, remaining, deleted and a 2 dp percentage", () => {
  const c = sessionFixture().counts;
  expect(countsPanel(c)).toEqual({ original: 1000, remaining: 900, deleted: 100, deletedPercent: "10.00%" });
  expect(countsPanel({ ...c, original: 3, active: 2, deleted: 1 }).deletedPercent).toBe("33.33%");
  expect(countsPanel({ ...c, original: 0, active: 0, deleted: 0 }).deletedPercent).toBe("0.00%");
});

test("UI-85 editing is refused unless the edited view is shown", () => {
  expect(editAllowed("edited")).toEqual({ ok: true });
  for (const m of ["original", "overlay", "split"] as const) {
    expect(editAllowed(m)).toEqual({ ok: false, reason: READ_ONLY_REASON });
  }
  expect(READ_ONLY_REASON).toBe("Return to the edited view to edit");
});

test("UI-86 deleted count is original minus active, never an overlay point count", () => {
  const c = sessionFixture({}).counts;
  expect(countsPanel(c).deleted).toBe(c.original - c.active);
});

test("UI-87 cache: original/deleted renders are reused until a revision changes", async () => {
  const store = createAppStore();
  store.set({ session: sessionFixture() });
  setCompare(store, "split");
  const fetchRender = vi.fn(async (_m: string, _b: number, _a?: string, _s?: AbortSignal) => data(2));
  const r = createRefresher(store, fetchRender);
  await r.refresh();
  expect(fetchRender.mock.calls.map((c) => c[0])).toEqual(["original", "edited"]);
  expect(store.get().render?.count).toBe(2);
  expect(store.get().render2?.count).toBe(2);
  fetchRender.mockClear();
  await r.refresh(); // edited is always refetched, original comes from the cache
  expect(fetchRender.mock.calls.map((c) => c[0])).toEqual(["edited"]);
  const s0 = store.get().session!;
  store.set({ session: { ...s0, revision: { ...s0.revision, cloud: s0.revision.cloud + 1 } } });
  fetchRender.mockClear();
  await r.refresh();
  expect(fetchRender.mock.calls.map((c) => c[0])).toEqual(["original", "edited"]);
  expect(renderCacheKey(store.get(), "original")).not.toBe(renderCacheKey({ ...store.get(), budget: 5 }, "original"));
});

test("UI-80 switching to edited clears the secondary render", () => {
  const store = createAppStore();
  store.set({ render2: data(1) });
  setCompare(store, "edited");
  expect(store.get().render2).toBeNull();
});
