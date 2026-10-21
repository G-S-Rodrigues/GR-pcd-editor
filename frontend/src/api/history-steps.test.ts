import { afterEach, expect, test, vi } from "vitest";
import { setSessionId } from "../files/http";
import { stubFetch } from "../files/testing/fetch";
import { renderQuery } from "../render/parse";
import { deleteStep, renameStep, rollback } from "./session";

afterEach(() => {
  vi.unstubAllGlobals();
  setSessionId(null);
});

const RAW = {
  session_id: "s1",
  filename: "a.pcd",
  schema: [],
  counts: {},
  bounds: null,
  active_bounds: null,
  history: { entries: [], cursor: 0, can_undo: false, can_redo: false },
  client_state: {},
};

test("UI-267 rollback, deleteStep and renameStep build the exact URL, body and session header", async () => {
  setSessionId("s1");
  const calls = stubFetch(() => ({ body: RAW }));
  const seen: (HeadersInit | undefined)[] = [];
  const f = globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } };
  await rollback(4, 1);
  await deleteStep(4, 12);
  const s = await renameStep(12, "Mirror");
  await renameStep(12, "");
  expect(s.session_id).toBe("s1");
  expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
    ["POST", "/api/session/history/rollback", { cloud_revision: 4, cursor: 1 }],
    ["POST", "/api/session/history/delete-step", { cloud_revision: 4, sid: 12 }],
    ["POST", "/api/session/history/rename", { sid: 12, name: "Mirror" }],
    ["POST", "/api/session/history/rename", { sid: 12, name: "" }],
  ]);
  for (const c of f.mock.calls) seen.push(c[1].headers);
  for (const h of seen) expect(h).toMatchObject({ "X-Session-Id": "s1" });
});

test("UI-267 a 409 stale_revision and a 404 no_such_step keep their code", async () => {
  stubFetch(() => ({ status: 409, body: { error: { code: "stale_revision", message: "old" } } }));
  await expect(rollback(1, 0)).rejects.toMatchObject({ status: 409, code: "stale_revision" });
  stubFetch(() => ({ status: 404, body: { error: { code: "no_such_step", message: "gone" } } }));
  await expect(renameStep(9, "x")).rejects.toMatchObject({ status: 404, code: "no_such_step" });
});

test("UI-268 the step render query is mode=step&step=<sid>&budget=N and the others are unchanged", () => {
  expect(renderQuery("step", 5000, undefined, 12)).toBe("mode=step&step=12&budget=5000");
  expect(renderQuery("edited", 5000, "intensity")).toBe("mode=edited&budget=5000&attr=intensity");
});
