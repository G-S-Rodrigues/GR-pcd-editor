import { addNotice, clearNotices, type AppState } from "../state/app";
import type { Store } from "../state/store";

export const JOB_HINT_MS = 10_000;
export const JOB_HINT_TEXT = "Still working. Large clouds can take a while; use Cancel to stop.";

/** Adds an info notice when one job stays busy past JOB_HINT_MS; removes it when the job ends. */
export function createJobHint(store: Store<AppState>): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  store.select(
    (s) => s.job.busy,
    (busy) => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (busy) timer = setTimeout(() => addNotice(store, "info", "job_slow", JOB_HINT_TEXT), JOB_HINT_MS);
      else clearNotices(store, ["job_slow"]);
    },
  );
}
