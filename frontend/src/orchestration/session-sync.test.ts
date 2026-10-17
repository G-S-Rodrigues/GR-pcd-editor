import { afterEach, expect, test, vi } from "vitest";
import { renderCacheKey } from "../compare/model";
import { stubFetch } from "../files/testing/fetch";
import { sessionFixture } from "../testing/fixtures";
import { createAppStore } from "../state/app";
import { openSource } from "./open";
import { createSessionSync } from "./session-sync";

afterEach(() => vi.unstubAllGlobals());

const wire = (s: ReturnType<typeof sessionFixture>) => ({ ...s, bounds: null, active_bounds: null });

function setup(serverState: ReturnType<typeof sessionFixture> | null) {
  const store = createAppStore();
  store.set({ session: sessionFixture({ session_id: "A" }), render: {} as never });
  stubFetch(() => ({ body: serverState ? wire(serverState) : { no_session: true } }));
  const clear = vi.fn();
  const refresh = vi.fn(async () => true);
  return { store, clear, refresh, sync: createSessionSync(store, { clear, refresh }) };
}

test("UI-153 session_changed reloads the state, clears the cache and tells the user", async () => {
  const t = setup(sessionFixture({ session_id: "B" }));
  await t.sync.onChanged();
  expect(t.store.get().session?.session_id).toBe("B");
  expect(t.store.get().render).toBeNull();
  expect(t.store.get().candidate).toBeNull();
  expect(t.clear).toHaveBeenCalled();
  expect(t.refresh).toHaveBeenCalled();
  expect(t.store.get().notices.map((n) => n.text)).toContain(
    "This session was replaced in another tab; reloaded",
  );
});

test("UI-153b the session is gone: the store drops it", async () => {
  const t = setup(null);
  await t.sync.onChanged();
  expect(t.store.get().session).toBeNull();
});

test("UI-154 the render cache key includes the session id and the selection id", () => {
  const mk = (id: string, sel: number, count = 5) =>
    ({
      ...createAppStore().get(),
      session: sessionFixture({ session_id: id, selection: { id: sel, count, ops: [] } }),
    });
  expect(renderCacheKey(mk("A", 1), "original")).not.toBe(renderCacheKey(mk("B", 1), "original"));
  // same count, different selection identity
  expect(renderCacheKey(mk("A", 1), "original")).not.toBe(renderCacheKey(mk("A", 2), "original"));
  expect(renderCacheKey(mk("A", 1), "original")).toBe(renderCacheKey(mk("A", 1), "original"));
});

test("UI-155 opening a file clears the render cache", async () => {
  const store = createAppStore();
  stubFetch(() => ({ body: { ...wire(sessionFixture()), client_state: {} } }));
  const clearCache = vi.fn();
  await openSource(
    { kind: "picker", file: { name: "a.pcd", size: 1 } as unknown as File },
    {
      store,
      confirm: () => true,
      refresh: async () => true,
      clearCache,
      upload: () => ({ uploadId: "u", cancel: () => true, promise: Promise.resolve({}) }),
    },
  );
  expect(clearCache).toHaveBeenCalledTimes(1);
});

test("UI-156 a focus check reloads on a changed session id or revision, and is silent otherwise", async () => {
  const same = setup(sessionFixture({ session_id: "A" }));
  await same.sync.check();
  expect(same.refresh).not.toHaveBeenCalled();
  expect(same.store.get().notices).toEqual([]);

  const otherId = setup(sessionFixture({ session_id: "B" }));
  await otherId.sync.check();
  expect(otherId.store.get().notices.map((n) => n.text)).toContain(
    "This session changed in another tab; reloaded",
  );

  const rev = setup(sessionFixture({ session_id: "A", revision: { cloud: 99, params: 4 } }));
  await rev.sync.check();
  expect(rev.store.get().session?.revision.cloud).toBe(99);
  expect(rev.refresh).toHaveBeenCalled();
});

test("UI-156b no session open locally: nothing to compare", async () => {
  const t = setup(sessionFixture({ session_id: "B" }));
  t.store.set({ session: null });
  await t.sync.check();
  expect(t.refresh).not.toHaveBeenCalled();
});

test("UI-182 check() answers whether this tab is still on the server's session (m-1)", async () => {
  const same = setup(sessionFixture({ session_id: "A" }));
  expect(await same.sync.check()).toBe(true);
  expect(same.clear).not.toHaveBeenCalled();
  const other = setup(sessionFixture({ session_id: "B" }));
  expect(await other.sync.check()).toBe(false);
  expect(other.store.get().session?.session_id).toBe("B");
  const gone = setup(null);
  expect(await gone.sync.check()).toBe(false);
});
