/** Trailing-edge debouncer on the global timers (so tests can use fake timers). */
export function createDebouncer(ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    call(fn: () => void): void {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, ms);
    },
    cancel(): void {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
    pending: () => timer !== null,
  };
}
