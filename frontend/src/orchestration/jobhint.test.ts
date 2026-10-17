import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createAppStore } from "../state/app";
import { JOB_HINT_MS, JOB_HINT_TEXT, createJobHint } from "./jobhint";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const busy = (store: ReturnType<typeof createAppStore>, on: boolean) =>
  store.set({ job: { busy: on, progress: null, message: on ? "Evaluating selection" : null } });
const hint = (store: ReturnType<typeof createAppStore>) => store.get().notices.find((n) => n.code === "job_slow");

test("UI-173 a job still running after 10 s gets a 'still working' hint; a quicker one never does", () => {
  const store = createAppStore();
  createJobHint(store);
  expect(JOB_HINT_MS).toBe(10_000);
  busy(store, true);
  vi.advanceTimersByTime(9999);
  expect(hint(store)).toBeUndefined();
  vi.advanceTimersByTime(1);
  expect(hint(store)?.text).toBe(JOB_HINT_TEXT);
  expect(JOB_HINT_TEXT).toMatch(/Cancel/);
  expect(hint(store)?.level).toBe("info");

  const quick = createAppStore();
  createJobHint(quick);
  busy(quick, true);
  vi.advanceTimersByTime(5000);
  busy(quick, false);
  vi.advanceTimersByTime(20_000);
  expect(hint(quick)).toBeUndefined();
});

test("UI-173 the hint goes when the job ends, and a new job starts a new clock", () => {
  const store = createAppStore();
  createJobHint(store);
  busy(store, true);
  vi.advanceTimersByTime(10_000);
  expect(hint(store)).toBeDefined();
  busy(store, false);
  expect(hint(store)).toBeUndefined();
  busy(store, true);
  vi.advanceTimersByTime(9000);
  expect(hint(store)).toBeUndefined();
  vi.advanceTimersByTime(1000);
  expect(hint(store)).toBeDefined();
});

test("UI-173 progress updates during one job do not restart the clock", () => {
  const store = createAppStore();
  createJobHint(store);
  busy(store, true);
  vi.advanceTimersByTime(6000);
  store.set({ job: { busy: true, progress: 0.3, message: "Evaluating selection" } });
  vi.advanceTimersByTime(4000);
  expect(hint(store)).toBeDefined();
});
