import { afterEach, expect, test, vi } from "vitest";
import { ApiError } from "../files/errors";
import { stubFetch } from "../files/testing/fetch";
import { createAppStore } from "../state/app";
import type { SessionState } from "../state/types";
import { openSource } from "./open";

afterEach(() => vi.unstubAllGlobals());

const STATE = (unsaved = false, name = "a.pcd") =>
  ({ session_id: "s", filename: name, unsaved, revision: { cloud: 0, params: 0 }, counts: {}, schema: [] }) as unknown as SessionState;

function setup(opts: { unsaved?: boolean; withSession?: boolean; confirm?: boolean } = {}) {
  const store = createAppStore();
  if (opts.withSession) store.set({ session: STATE(opts.unsaved ?? false, "old.pcd") });
  const confirm = vi.fn(async () => opts.confirm ?? true);
  const uploads: { name: string; replace: boolean | undefined }[] = [];
  const upload = vi.fn((file: File, o: { replace?: boolean; onProgress?: (p: { loaded: number; total: number | null }) => void; onPhase?: (p: "sending" | "importing") => void }) => {
    uploads.push({ name: file.name, replace: o.replace });
    o.onPhase?.("sending");
    o.onProgress?.({ loaded: 5, total: 10 });
    o.onPhase?.("importing");
    return { uploadId: "u", cancel: () => true, promise: Promise.resolve({}) };
  });
  const mounted = vi.fn(async () => ({}));
  const refresh = vi.fn(async () => true);
  const calls = stubFetch(() => ({ body: { ...STATE(false, "new.pcd"), bounds: null, active_bounds: null, client_state: {} } }));
  const deps = { store, confirm, upload, openMounted: mounted, refresh };
  return { store, confirm, upload, uploads, mounted, refresh, calls, deps };
}
const file = (name: string) => ({ name, size: 1 }) as unknown as File;

test("UI-18 picker with no session: no confirm, replace false, progress lands in store", async () => {
  const s = setup();
  const seen: unknown[] = [];
  s.store.subscribe((st) => seen.push(st.upload));
  const r = await openSource({ kind: "picker", file: file("a.pcd") }, s.deps);
  expect(r).toEqual({ ok: true });
  expect(s.confirm).not.toHaveBeenCalled();
  expect(s.uploads).toEqual([{ name: "a.pcd", replace: false }]);
  expect(seen).toContainEqual({ phase: "sending", loaded: 0, total: null });
  expect(seen).toContainEqual({ phase: "importing", loaded: 5, total: 10 });
  expect(s.store.get().upload).toBeNull();
  expect(s.store.get().session?.filename).toBe("new.pcd");
  expect(s.refresh).toHaveBeenCalledTimes(1);
});

test("UI-19 unsaved session: confirm; decline sends nothing, accept replaces", async () => {
  const d = setup({ withSession: true, unsaved: true, confirm: false });
  expect(await openSource({ kind: "picker", file: file("b.pcd") }, d.deps)).toEqual({ ok: false, reason: "declined" });
  expect(d.confirm).toHaveBeenCalledTimes(1);
  expect(d.upload).not.toHaveBeenCalled();
  expect(d.calls).toHaveLength(0);
  expect(d.store.get().session?.filename).toBe("old.pcd");
  const a = setup({ withSession: true, unsaved: true, confirm: true });
  await openSource({ kind: "picker", file: file("b.pcd") }, a.deps);
  expect(a.uploads[0].replace).toBe(true);
});

test("UI-19 saved session needs no confirm and sends replace false", async () => {
  const d = setup({ withSession: true, unsaved: false });
  await openSource({ kind: "picker", file: file("b.pcd") }, d.deps);
  expect(d.confirm).not.toHaveBeenCalled();
  expect(d.uploads[0].replace).toBe(false);
});

test("UI-19 a failing import keeps the old session and reports a notice", async () => {
  const d = setup({ withSession: true, unsaved: true, confirm: true });
  d.upload.mockImplementation((() => ({
    uploadId: "u",
    cancel: () => true,
    promise: Promise.reject(new ApiError(422, "bad_header", "bad PCD header")),
  })) as never);
  const r = await openSource({ kind: "picker", file: file("bad.pcd") }, d.deps);
  expect(r).toMatchObject({ ok: false, reason: "error", code: "bad_header" });
  expect(d.store.get().session?.filename).toBe("old.pcd");
  expect(d.store.get().upload).toBeNull();
  expect(d.store.get().notices.at(-1)?.text).toContain("bad PCD header");
  expect(d.refresh).not.toHaveBeenCalled();
});

test("UI-20 dropping a non-PCD or several files produces a notice and no request", async () => {
  const d = setup();
  const bad = { files: [file("a.txt")] };
  expect(await openSource({ kind: "drop", dt: bad }, d.deps)).toMatchObject({ ok: false, code: "unsupported_type" });
  const many = { files: [file("a.pcd"), file("b.pcd")] };
  expect(await openSource({ kind: "drop", dt: many }, d.deps)).toMatchObject({ ok: false, code: "multiple_files" });
  expect(d.upload).not.toHaveBeenCalled();
  expect(d.calls).toHaveLength(0);
  expect(d.store.get().notices.map((n) => n.code)).toEqual(["unsupported_type", "multiple_files"]);
  await openSource({ kind: "drop", dt: { files: [file("ok.pcd")] } }, d.deps);
  expect(d.uploads).toEqual([{ name: "ok.pcd", replace: false }]);
});

test("UI-21 mounted choices use the pcd or archive path; session archives are sent as kind session", async () => {
  const d = setup();
  await openSource({ kind: "mounted", path: "maps/a.pcdsession", itemKind: "session" }, d.deps);
  expect(d.mounted).toHaveBeenCalledWith("maps/a.pcdsession", "session", false);
  await openSource({ kind: "mounted", path: "maps/a.pcd", itemKind: "pcd" }, d.deps);
  expect(d.mounted).toHaveBeenLastCalledWith("maps/a.pcd", "pcd", false);
  await openSource({ kind: "picker", file: file("x.pcdsession") }, d.deps);
  expect(d.uploads.at(-1)?.name).toBe("x.pcdsession");
});
