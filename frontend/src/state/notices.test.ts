import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { addNotice, createAppStore, dismissNotice } from "./app";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test("UI-166 info and warning notices dismiss themselves after 8 s, errors after 15 s", () => {
  const store = createAppStore();
  addNotice(store, "warn", "w", "careful");
  addNotice(store, "info", "i", "fyi");
  addNotice(store, "error", "e", "broken");
  expect(store.get().notices).toHaveLength(3);
  vi.advanceTimersByTime(7999);
  expect(store.get().notices).toHaveLength(3);
  vi.advanceTimersByTime(1);
  expect(store.get().notices.map((n) => n.code)).toEqual(["e"]);
  vi.advanceTimersByTime(6999);
  expect(store.get().notices).toHaveLength(1);
  vi.advanceTimersByTime(1);
  expect(store.get().notices).toHaveLength(0);
});

test("UI-166 a repeated notice restarts its own clock and an older timer never removes the newer one", () => {
  const store = createAppStore();
  addNotice(store, "warn", "w", "first");
  vi.advanceTimersByTime(5000);
  addNotice(store, "warn", "w", "second");
  vi.advanceTimersByTime(4000); // 9 s after the first, 4 s after the second
  expect(store.get().notices.map((n) => n.text)).toEqual(["second"]);
  vi.advanceTimersByTime(4000);
  expect(store.get().notices).toHaveLength(0);
});

test("UI-166 dismissing by hand leaves nothing for the timer to remove", () => {
  const store = createAppStore();
  addNotice(store, "warn", "w", "x");
  dismissNotice(store, store.get().notices[0].id);
  addNotice(store, "error", "e", "y");
  vi.advanceTimersByTime(9000);
  expect(store.get().notices.map((n) => n.code)).toEqual(["e"]);
});
