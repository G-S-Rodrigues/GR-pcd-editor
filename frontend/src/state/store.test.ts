import { expect, test, vi } from "vitest";
import { createStore } from "./store";

test("UI-01 store get/set/update, subscribe/unsubscribe", () => {
  const s = createStore({ a: 1, b: 2 });
  const fn = vi.fn();
  const off = s.subscribe(fn);
  s.set({ a: 5 });
  expect(s.get()).toEqual({ a: 5, b: 2 });
  s.update((x) => ({ ...x, b: x.b + 1 }));
  expect(s.get().b).toBe(3);
  expect(fn).toHaveBeenCalledTimes(2);
  off();
  s.set({ a: 9 });
  expect(fn).toHaveBeenCalledTimes(2);
});

test("UI-01 one notification per batch", () => {
  const s = createStore({ a: 1, b: 2 });
  const fn = vi.fn();
  s.subscribe(fn);
  s.batch(() => {
    s.set({ a: 2 });
    s.set({ b: 3 });
    s.update((x) => ({ ...x, a: x.a + 1 }));
  });
  expect(fn).toHaveBeenCalledTimes(1);
  expect(s.get()).toEqual({ a: 3, b: 3 });
});

test("UI-01 selector fires only when the selected value changes", () => {
  const s = createStore({ a: 1, b: 2 });
  const fn = vi.fn();
  s.select((x) => x.a, fn);
  s.set({ b: 10 });
  expect(fn).not.toHaveBeenCalled();
  s.set({ a: 2 });
  expect(fn).toHaveBeenCalledWith(2, 1);
});
