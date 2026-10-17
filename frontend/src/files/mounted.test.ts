import { afterEach, expect, test, vi } from "vitest";
import { listMounted, openMounted } from "./mounted";
import { stubFetch } from "./testing/fetch";

afterEach(() => vi.unstubAllGlobals());

test("FE-F-11 listMounted URL-encodes the path", async () => {
  const calls = stubFetch(() => ({ body: { path: "", entries: [], truncated: false } }));
  await listMounted("");
  await listMounted("a b/c&d");
  expect(calls[0]!.url).toBe("/api/mounted?path=");
  expect(calls[1]!.url).toBe("/api/mounted?path=a%20b%2Fc%26d");
});

test("FE-F-12 openMounted posts path and replace to the right route", async () => {
  const calls = stubFetch(() => ({ body: {} }));
  await openMounted("s/a.pcd", "pcd", true);
  await openMounted("s/a.pcdsession", "session");
  expect(calls[0]).toEqual({
    method: "POST",
    url: "/api/session/open",
    body: { path: "s/a.pcd", replace: true },
  });
  expect(calls[1]).toEqual({
    method: "POST",
    url: "/api/session/open-archive",
    body: { path: "s/a.pcdsession", replace: false },
  });
});

test("FE-F-13 escaping paths are rejected before any request", async () => {
  const calls = stubFetch(() => ({ body: {} }));
  for (const bad of ["/etc", "../x", "a/../b", "a\\b"]) {
    await expect(listMounted(bad)).rejects.toMatchObject({ code: "path_escape" });
    await expect(openMounted(bad, "pcd")).rejects.toMatchObject({ code: "path_escape" });
  }
  expect(calls).toHaveLength(0);
});
