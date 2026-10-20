import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { markSaved, startExport, startSave } from "./downloads";
import { stubFetch } from "./testing/fetch";

const clicks: { href: string; download: string }[] = [];

beforeEach(() => {
  clicks.length = 0;
  vi.stubGlobal("document", {
    createElement: () => {
      const a = {
        href: "",
        download: "",
        click: () => clicks.push({ href: a.href, download: a.download }),
        remove: () => undefined,
      };
      return a;
    },
    body: { appendChild: () => undefined },
  });
});
afterEach(() => vi.unstubAllGlobals());

function jobFlow(result: unknown, status = "complete", error?: unknown) {
  return stubFetch((method) =>
    method === "POST"
      ? { status: 202, body: { id: "j" } }
      : { body: { id: "j", status, result, error } },
  );
}

test("FE-F-16 export ends with an anchor click on the export URL", async () => {
  jobFlow({ export_id: "e1", filename: "a_cleaned.pcd" });
  const dl = await startExport("binary", "active");
  expect(dl).toEqual({ url: "/api/exports/e1", filename: "a_cleaned.pcd" });
  expect(clicks).toEqual([{ href: "/api/exports/e1", download: "a_cleaned.pcd" }]);
});

test("FE-F-17 save returns the archive id and does not mark it saved", async () => {
  const calls = jobFlow({ archive_id: "a1", filename: "a_session_v1.pcdsession" });
  const dl = await startSave();
  expect(dl.archiveId).toBe("a1");
  expect(clicks[0]!.href).toBe("/api/session-archives/a1");
  expect(calls.some((c) => c.url.includes("mark-saved"))).toBe(false);
});

test("FE-F-18 markSaved posts the archive id", async () => {
  const calls = stubFetch(() => ({ body: { unsaved: false } }));
  await markSaved("a1");
  expect(calls[0]).toEqual({
    method: "POST",
    url: "/api/session/mark-saved",
    body: { archive_id: "a1" },
  });
});

test("FE-F-19 a failed export rejects and never clicks", async () => {
  jobFlow(undefined, "failed", { code: "storage_full", message: "full" });
  await expect(startExport("ascii", "selected")).rejects.toMatchObject({ code: "storage_full" });
  expect(clicks).toHaveLength(0);
});

test("UI-842 the export request carries layers only when asked, so the default body is exactly format and scope", async () => {
  const calls = jobFlow({ export_id: "e1", filename: "a_cleaned.pcd" });
  await startExport("binary", "active");
  expect(calls[0]!.body).toEqual({ format: "binary", scope: "active" });
  const calls2 = jobFlow({ export_id: "e2", filename: "a_cleaned.pcd", count: 12 });
  const dl = await startExport("ascii", "active", {}, [0, 2]);
  expect(calls2[0]!.body).toEqual({ format: "ascii", scope: "active", layers: [0, 2] });
  expect(dl.count).toBe(12);
});
