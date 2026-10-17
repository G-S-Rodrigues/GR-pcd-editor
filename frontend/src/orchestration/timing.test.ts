import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDebouncer } from "./timing";

describe("debouncer max wait", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("UI-194 without a max wait a steady stream never fires until it stops", () => {
    const d = createDebouncer(150);
    const fn = vi.fn();
    for (let i = 0; i < 20; i++) {
      d.call(fn);
      vi.advanceTimersByTime(50);
    }
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("UI-194 with a max wait of 200 ms a 1 s stream fires 4-6 times and the last value wins", () => {
    const d = createDebouncer(150, { maxWaitMs: 200 });
    const seen: number[] = [];
    for (let i = 0; i < 20; i++) {
      d.call(() => seen.push(i));
      vi.advanceTimersByTime(50);
    }
    vi.advanceTimersByTime(300);
    expect(seen.length).toBeGreaterThanOrEqual(4);
    expect(seen.length).toBeLessThanOrEqual(6);
    expect(seen[seen.length - 1]).toBe(19);
    expect(d.pending()).toBe(false);
  });
});
