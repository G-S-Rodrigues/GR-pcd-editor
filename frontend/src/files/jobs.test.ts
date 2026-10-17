import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { pollJob } from "./jobs";
import { stubFetch } from "./testing/fetch";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("FE-F-14 polls to completion, reports progress and returns the result", async () => {
  let n = 0;
  stubFetch(() => {
    n += 1;
    return n < 3
      ? { body: { id: "j", status: "running", progress: n / 10 } }
      : { body: { id: "j", status: "complete", result: { export_id: "e1" } } };
  });
  const progress: unknown[] = [];
  const p = pollJob("j", { intervalMs: 10, onProgress: (x) => progress.push(x) });
  await vi.advanceTimersByTimeAsync(100);
  await expect(p).resolves.toEqual({ export_id: "e1" });
  expect(progress.slice(0, 2)).toEqual([0.1, 0.2]);
});

test("FE-F-14 a failed job throws its error code", async () => {
  stubFetch(() => ({
    body: { id: "j", status: "failed", error: { code: "invalid_seed", message: "bad seed" } },
  }));
  await expect(pollJob("j")).rejects.toMatchObject({ code: "invalid_seed", message: "bad seed" });
});

test("FE-F-15 abort stops polling and cancels the job", async () => {
  const calls = stubFetch(() => ({ body: { id: "j", status: "running" } }));
  const ac = new AbortController();
  const p = pollJob("j", { intervalMs: 1000, signal: ac.signal });
  const rejected = expect(p).rejects.toMatchObject({ code: "cancelled" });
  await vi.advanceTimersByTimeAsync(10);
  ac.abort();
  await vi.advanceTimersByTimeAsync(10);
  await rejected;
  expect(calls.at(-1)).toMatchObject({ method: "POST", url: "/api/jobs/j/cancel" });
});
