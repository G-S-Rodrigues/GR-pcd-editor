import { afterEach, expect, test, vi } from "vitest";
import { stubFetch } from "./testing/fetch";
import { FakeXhr } from "./testing/fakeXhr";
import { uploadFile } from "./upload";

afterEach(() => vi.unstubAllGlobals());

const ID = "ab".repeat(16);
const file = { name: "my scan.pcd", size: 10 } as unknown as File;

function start(opts = {}) {
  const xhr = new FakeXhr();
  const h = uploadFile(file, opts, { createXhr: () => xhr, randomId: () => ID });
  return { xhr, h };
}

test("FE-F-05 builds the URL, headers and body", () => {
  const { xhr } = start({ replace: true });
  expect(xhr.method).toBe("POST");
  const url = new URL(xhr.url, "http://x");
  expect(url.pathname).toBe("/api/session/upload");
  expect(url.searchParams.get("upload_id")).toBe(ID);
  expect(url.searchParams.get("filename")).toBe("my scan.pcd");
  expect(url.searchParams.get("replace")).toBe("true");
  expect(xhr.headers["Content-Type"]).toBe("application/octet-stream");
  expect(xhr.body).toBe(file);
});

test("FE-F-06 progress, phases and the parsed session state", async () => {
  const progress: unknown[] = [];
  const phases: string[] = [];
  const { xhr, h } = start({
    onProgress: (p: unknown) => progress.push(p),
    onPhase: (p: string) => phases.push(p),
  });
  xhr.progress(5, 10);
  xhr.finishSending();
  xhr.respond(200, { session_id: "s1" });
  await expect(h.promise).resolves.toEqual({ session_id: "s1" });
  expect(progress).toEqual([{ loaded: 5, total: 10 }]);
  expect(phases).toEqual(["sending", "importing"]);
});

test("FE-F-07 cancel aborts, sends DELETE and rejects as cancelled", async () => {
  const calls = stubFetch(() => ({ body: {} }));
  const { xhr, h } = start();
  const rejected = expect(h.promise).rejects.toMatchObject({ code: "cancelled" });
  expect(h.cancel()).toBe(true);
  await rejected;
  expect(xhr.aborted).toBe(true);
  expect(calls[0]).toMatchObject({ method: "DELETE", url: `/api/uploads/${ID}` });
});

test("FE-F-08 a 413 upload_too_large is surfaced", async () => {
  const { xhr, h } = start();
  xhr.respond(413, { error: { code: "upload_too_large", message: "over 16 GiB" } });
  await expect(h.promise).rejects.toMatchObject({
    status: 413,
    code: "upload_too_large",
    message: "over 16 GiB",
  });
});

test("FE-F-09 a 409 unsaved_work lets the UI retry with replace", async () => {
  const { xhr, h } = start();
  xhr.respond(409, { error: { code: "unsaved_work", message: "unsaved" } });
  await expect(h.promise).rejects.toMatchObject({ code: "unsaved_work" });
});

test("FE-F-10 cancel is a no-op once import has begun", async () => {
  const { xhr, h } = start();
  xhr.finishSending();
  expect(h.cancel()).toBe(false);
  expect(xhr.aborted).toBe(false);
  xhr.respond(200, {});
  await h.promise;
});

test("a connection failure rejects as network", async () => {
  const { xhr, h } = start();
  xhr.onerror?.();
  await expect(h.promise).rejects.toMatchObject({ code: "network" });
});
