/** Minimal synchronous store; subscribers are notified once per batch. */
export interface Store<T extends object> {
  get(): T;
  set(patch: Partial<T>): void;
  update(fn: (s: T) => T): void;
  subscribe(fn: (s: T) => void): () => void;
  select<V>(selector: (s: T) => V, fn: (v: V, prev: V) => void): () => void;
  batch(fn: () => void): void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  let depth = 0;
  let dirty = false;
  const subs = new Set<(s: T) => void>();

  const notify = () => {
    if (depth > 0) {
      dirty = true;
      return;
    }
    for (const fn of [...subs]) fn(state);
  };

  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...patch };
      notify();
    },
    update(fn) {
      state = fn(state);
      notify();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    select(selector, fn) {
      let prev = selector(state);
      return this.subscribe((s) => {
        const next = selector(s);
        if (!Object.is(next, prev)) {
          const old = prev;
          prev = next;
          fn(next, old);
        }
      });
    },
    batch(fn) {
      depth += 1;
      try {
        fn();
      } finally {
        depth -= 1;
        if (depth === 0 && dirty) {
          dirty = false;
          notify();
        }
      }
    },
  };
}
