export interface DebounceOptions {
  /** Longest a steady stream of calls may keep the callback waiting (ms); unset = trailing edge only. */
  maxWaitMs?: number;
}

/** Trailing-edge debouncer on the global timers (so tests can use fake timers); optional max wait for live drags. */
export function createDebouncer(ms: number, opts: DebounceOptions = {}) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let firstAt = 0;
  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return {
    call(fn: () => void): void {
      const now = Date.now();
      if (timer === null) firstAt = now;
      else clearTimeout(timer);
      const wait = opts.maxWaitMs === undefined ? ms : Math.max(0, Math.min(ms, firstAt + opts.maxWaitMs - now));
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, wait);
    },
    cancel(): void {
      clear();
    },
    pending: () => timer !== null,
  };
}
