import { afterEach, expect, test, vi } from "vitest";
import { sessionFixture } from "../testing/fixtures";
import { createAppStore } from "../state/app";
import { adoptExisting } from "./adopt";
import { openSource } from "./open";

afterEach(() => vi.unstubAllGlobals());

const wire = (s: ReturnType<typeof sessionFixture>) => ({ ...s, bounds: null, active_bounds: null });

/** A fetch whose answer is released by the test, so the startup GET can resolve after a newer open. */
function heldState(body: unknown) {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      await gate;
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  return release;
}

function deps() {
  return { onOpened: vi.fn(), refresh: vi.fn(async () => true) };
}

test("UI-1250 a startup GET that answers after a newer open does not overwrite it", async () => {
  const store = createAppStore();
  const release = heldState(wire(sessionFixture({ session_id: "A" })));
  const d = deps();
  const done = adoptExisting(store, d);
  store.set({ session: sessionFixture({ session_id: "B" }) }); // the file the user opened meanwhile
  release();
  expect(await done).toBe(false);
  expect(store.get().session?.session_id).toBe("B");
  expect(d.onOpened).not.toHaveBeenCalled();
  expect(d.refresh).not.toHaveBeenCalled();
});

test("UI-1251 a startup GET that answers while an upload is in flight is dropped", async () => {
  const store = createAppStore();
  const release = heldState(wire(sessionFixture({ session_id: "A" })));
  const d = deps();
  const done = adoptExisting(store, d);
  store.set({ upload: { phase: "sending", loaded: 1, total: 10 } });
  release();
  expect(await done).toBe(false);
  expect(store.get().session).toBeNull();
  expect(d.onOpened).not.toHaveBeenCalled();
});

test("UI-1252 with nothing newer, the existing session is adopted, restored and drawn", async () => {
  const store = createAppStore();
  const release = heldState(wire(sessionFixture({ session_id: "A" })));
  const d = deps();
  const done = adoptExisting(store, d);
  release();
  expect(await done).toBe(true);
  expect(store.get().session?.session_id).toBe("A");
  expect(d.onOpened).toHaveBeenCalledTimes(1);
  expect(d.refresh).toHaveBeenCalledTimes(1);
});

test("UI-1266 an upload that fails while the startup GET was held adopts the session the server still holds", async () => {
  const store = createAppStore();
  const release = heldState(wire(sessionFixture({ session_id: "A" })));
  const d = deps();
  const first = adoptExisting(store, d);
  let fail: (e: Error) => void = () => undefined;
  const upload = (_f: File, o: { onPhase?: (p: "sending" | "importing") => void }) => {
    o.onPhase?.("sending");
    return { promise: new Promise<never>((_, rej) => (fail = rej)) } as never;
  };
  const opening = openSource({ kind: "picker", file: new File(["x"], "b.pcd") }, { store, confirm: () => true, refresh: d.refresh, upload, onOpened: d.onOpened });
  release();
  expect(await first).toBe(false); // dropped: the upload is in flight
  expect(store.get().session).toBeNull();
  fail(new Error("boom"));
  expect(await opening).toMatchObject({ ok: false, reason: "error" });
  expect(store.get().session?.session_id).toBe("A");
  expect(store.get().upload).toBeNull();
  expect(d.onOpened).toHaveBeenCalledTimes(1);
});
