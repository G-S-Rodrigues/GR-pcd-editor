import { ApiError } from "./errors";
import { getJson, postJson } from "./http";

export interface JobView {
  id: string;
  status: string;
  progress?: number | null;
  message?: string | null;
  result?: Record<string, unknown>;
  error?: { code?: string; message?: string } | null;
}

export interface PollOptions {
  intervalMs?: number;
  signal?: AbortSignal;
  onProgress?: (progress: number | null, message: string | null) => void;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done);
  });
}

/** Polls a job until it ends; resolves with its result. */
export async function pollJob<R = Record<string, unknown>>(
  jobId: string,
  opts: PollOptions = {},
): Promise<R> {
  const interval = opts.intervalMs ?? 250;
  for (;;) {
    if (opts.signal?.aborted) {
      await postJson(`/api/jobs/${jobId}/cancel`).catch(() => undefined);
      throw new ApiError(0, "cancelled", "the job was cancelled");
    }
    const job = await getJson<JobView>(`/api/jobs/${jobId}`);
    opts.onProgress?.(job.progress ?? null, job.message ?? null);
    if (job.status === "complete") return (job.result ?? {}) as R;
    if (job.status === "failed") {
      throw new ApiError(
        422,
        job.error?.code ?? "job_failed",
        job.error?.message ?? "the job failed",
      );
    }
    if (job.status === "cancelled" || job.status === "stale") {
      throw new ApiError(409, job.status, `the job ended as ${job.status}`);
    }
    await sleep(interval, opts.signal);
  }
}
