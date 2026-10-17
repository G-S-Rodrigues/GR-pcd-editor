import { afterEach, expect, test, vi } from "vitest";
import { ApiError } from "./errors";
import { getJson, postJson } from "./http";
import { stubFetch } from "./testing/fetch";

afterEach(() => vi.unstubAllGlobals());

test("FE-F-01 ApiError is parsed from the error contract", async () => {
  stubFetch(() => ({ status: 409, body: { error: { code: "unsaved_work", message: "unsaved" } } }));
  const err = await postJson("/api/x").catch((e) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err).toMatchObject({ status: 409, code: "unsaved_work", message: "unsaved" });
});

test("FE-F-02 a non-JSON failure body becomes http_<status>", async () => {
  stubFetch(() => ({ status: 502, body: "<html>bad gateway</html>" }));
  await expect(getJson("/api/x")).rejects.toMatchObject({ code: "http_502", status: 502 });
});

test("FE-F-03 a network failure becomes code network", async () => {
  stubFetch(() => new TypeError("fetch failed"));
  await expect(getJson("/api/x")).rejects.toMatchObject({ code: "network" });
});

test("FE-F-04 JSON success is returned and bodies are sent as JSON", async () => {
  const calls = stubFetch(() => ({ body: { ok: 1 } }));
  expect(await postJson("/api/x", { a: 1 })).toEqual({ ok: 1 });
  expect(calls[0]).toEqual({ method: "POST", url: "/api/x", body: { a: 1 } });
});
