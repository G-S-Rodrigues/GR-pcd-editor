import { afterEach, expect, test, vi } from "vitest";
import { getJson, postJson, setSessionChangedHandler, setSessionId } from "./http";

afterEach(() => {
  vi.unstubAllGlobals();
  setSessionId(null);
  setSessionChangedHandler(null);
});

function stub(status = 200, body: unknown = {}) {
  const heads: (Record<string, string> | undefined)[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_u: string, init?: RequestInit) => {
      heads.push(init?.headers as Record<string, string> | undefined);
      return new Response(JSON.stringify(body), { status });
    }),
  );
  return heads;
}

test("UI-152 the client sends X-Session-Id once a session is known and not before", async () => {
  const heads = stub();
  await getJson("/api/x");
  expect(heads[0]?.["X-Session-Id"]).toBeUndefined();
  setSessionId("abc");
  await getJson("/api/x");
  await postJson("/api/y", { a: 1 });
  expect(heads[1]?.["X-Session-Id"]).toBe("abc");
  expect(heads[2]?.["X-Session-Id"]).toBe("abc");
  expect(heads[2]?.["Content-Type"]).toBe("application/json");
});

test("UI-152b a 409 session_changed calls the handler once and still rejects", async () => {
  stub(409, { error: { code: "session_changed", message: "m", session_id: "new" } });
  const handler = vi.fn();
  setSessionChangedHandler(handler);
  setSessionId("old");
  await expect(postJson("/api/session/undo", {})).rejects.toMatchObject({ code: "session_changed" });
  expect(handler).toHaveBeenCalledTimes(1);
});
