import { afterEach, expect, test, vi } from "vitest";
import { setSessionId } from "../files/http";
import { stubFetch } from "../files/testing/fetch";
import { detectPlanes } from "./session";

afterEach(() => {
  vi.unstubAllGlobals();
  setSessionId(null);
});

test("UI-965 detectPlanes posts the revision and parameters with the session header; a 409 is an ApiError the caller maps to the stale notice", async () => {
  setSessionId("s1");
  const calls = stubFetch(() => ({ body: { id: "j1" } }));
  const body = { cloud_revision: 4, scope: "displayed" as const, distance: 0.03, max_tilt_deg: 30, max_planes: 4, region: null, exclude_protected: true };
  expect(await detectPlanes(body)).toEqual({ id: "j1" });
  expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([["POST", "/api/session/planes/detect", body]]);
  const f = globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } };
  expect(f.mock.calls[0][1].headers).toMatchObject({ "X-Session-Id": "s1" });
  vi.unstubAllGlobals();
  stubFetch(() => ({ status: 409, body: { error: { code: "stale_revision", message: "The cloud changed" } } }));
  await expect(detectPlanes(body)).rejects.toMatchObject({ status: 409, code: "stale_revision" });
});
