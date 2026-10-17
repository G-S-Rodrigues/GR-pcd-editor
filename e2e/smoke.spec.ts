import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { FLOOR, GHOST, TOTAL, parsePcd, rowKey, syntheticPcd, truthKeys } from "./synthetic";

test("open a cloud, navigate, pick a pivot, colour, read counts", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // Startup probes GET /api/session; 404 means "no session yet" (API contract) and the
  // browser logs it as a failed resource load. Every other failure is an error.
  const expected404 = (url: string) => new URL(url).pathname === "/api/session";
  page.on("response", (r) => {
    if (r.status() >= 400 && !(r.status() === 404 && expected404(r.url()))) {
      errors.push(`HTTP ${r.status()} ${r.url()}`);
    }
  });
  page.on("console", (m) => {
    const loc = m.location().url;
    if (m.type() === "error" && !(loc && expected404(loc))) errors.push(m.text());
  });
  await page.goto("/");
  await expect(page.locator("#modebar")).toContainText("Frame: file (Z up) | Unit: m (assumed)".replace(" | ", " · "));
  const blank = await page.locator("#viewport").screenshot();

  await test.step("E2E-01 open via picker: counts and a drawn canvas", async () => {
    await page.locator("#file-input").setInputFiles({
      name: "synthetic.pcd",
      mimeType: "application/octet-stream",
      buffer: syntheticPcd(),
    });
    const status = page.locator("#statusbar");
    await expect(status.locator('[data-status="Original"]')).toContainText(String(TOTAL));
    await expect(status.locator('[data-status="Displayed"]')).toContainText(String(FLOOR + GHOST));
    await expect(status.locator('[data-status="Candidates"]')).toContainText("—");
    await expect(status.locator('[data-status="Invalid (active/total)"]')).toContainText("1 / 1");
    await expect(status.locator('[data-status="Rendered"]')).toContainText(`Rendered all ${FLOOR + GHOST} eligible points`);
    await page.waitForTimeout(500);
    const drawn = await page.locator("#viewport").screenshot();
    expect(Buffer.compare(blank, drawn)).not.toBe(0);
  });

  await test.step("E2E-02 views and projection", async () => {
    await page.locator('[data-control="view-top"]').click();
    await expect(page.locator("#inspector")).toContainText("Orthographic");
    await page.locator('[data-control="view-perspective"]').click();
    await expect(page.locator("#inspector")).toContainText("Perspective");
    await page.locator('[data-control="view-perspective"]').click();
    await page.locator('[data-control="view-top"]').click();
  });

  await test.step("E2E-02 pivot: reset, XYZ entry, pick", async () => {
    await page.locator('[data-control="pivot-reset"]').click();
    await expect(page.locator("#inspector")).toContainText("4.5, 4.5, 1.5");
    await page.locator('[data-control="pivot-x"]').fill("4");
    await page.locator('[data-control="pivot-y"]').fill("4");
    await page.locator('[data-control="pivot-z"]').fill("0");
    await page.locator('[data-control="pivot-set"]').click();
    await expect(page.locator("#inspector")).toContainText("Pivot4, 4, 0");
    await page.locator('[data-control="pivot-x"]').fill("abc");
    await page.locator('[data-control="pivot-set"]').click();
    await expect(page.locator("#notices")).toContainText("finite numbers");
    // top view: the point under the pivot with the greatest Z is the one picked
    await page.locator('[data-control="pivot-pick"]').click();
    await expect(page.locator("#modebar")).toContainText("Tool: Pick pivot");
    await page.locator("#viewport").click();
    await expect(page.locator("#inspector")).toContainText("Pivot4, 4, 3");
    await expect(page.locator("#modebar")).toContainText("Tool: None");
  });

  await test.step("E2E-01 colouring options follow the schema", async () => {
    const colour = page.locator('[data-control="colour-mode"]');
    await expect(colour.locator('option[value="rgb"]')).toHaveAttribute("disabled", "");
    const req = page.waitForRequest((r) => r.url().includes("attr=intensity"));
    await colour.selectOption("intensity");
    await req;
  });

  await page.screenshot({ path: "/out/editor.png" });
  expect(errors).toEqual([]);
});

test("E2E-01 open from the mounted folder (not an upload)", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-control="open-mounted"]').click();
  await expect(page.locator("#mounted-dialog")).toContainText("not an upload");
  await page.getByText("maps/", { exact: true }).click();
  await page.getByText("nine.pcd").click();
  await expect(page.locator('#statusbar [data-status="Original"]')).toContainText("9");
  await expect(page.locator("#inspector")).toContainText("nine.pcd");
});

test("E2E-01 open by dropping a file", async ({ page }) => {
  await page.goto("/");
  const dt = await page.evaluateHandle((text) => {
    const d = new DataTransfer();
    d.items.add(new File([text], "dropped.pcd"));
    return d;
  }, syntheticPcd().toString());
  await page.dispatchEvent("body", "drop", { dataTransfer: dt });
  await expect(page.locator('#statusbar [data-status="Original"]')).toContainText(String(TOTAL));
  const bad = await page.evaluateHandle(() => {
    const d = new DataTransfer();
    d.items.add(new File(["x"], "notes.txt"));
    return d;
  });
  await page.dispatchEvent("body", "drop", { dataTransfer: bad });
  await expect(page.locator("#notices")).toContainText("Only .pcd and .pcdsession");
});

test("6b real UI: filter, box select by numbers, preview counts, apply, undo, redo", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => {
    if (r.status() >= 400 && !(r.status() === 404 && new URL(r.url()).pathname === "/api/session")) {
      errors.push(`HTTP ${r.status()} ${r.url()}`);
    }
  });
  await page.goto("/");
  await page.locator("#file-input").setInputFiles({ name: "synthetic.pcd", mimeType: "application/octet-stream", buffer: syntheticPcd() });
  const status = page.locator("#statusbar");
  const stat = (name: string) => status.locator(`[data-status="${name}"]`);
  const exact = (name: string, v: number | string) => expect(stat(name)).toHaveText(new RegExp(`^${name.replace(/[()/]/g, "\\$&")}: ${v}$`), { timeout: 15000 });
  const num = async (name: string) => Number((await stat(name).innerText()).replace(/[^0-9]/g, ""));
  const ctl = (id: string) => page.locator(`[data-control="${id}"]`);
  const setNum = async (id: string, v: number) => {
    await ctl(id).fill(String(v));
    await ctl(id).press("Tab");
  };
  await exact("Displayed", String(FLOOR + GHOST));
  await expect(ctl("apply")).toBeDisabled();
  await expect(ctl("undo")).toBeDisabled();
  const activeBefore = await num("Active");

  await test.step("display filter on Z hides the floor without deleting it", async () => {
    await ctl("filter-z-enabled").check();
    await setNum("filter-z-min", 0.5);
    await setNum("filter-z-max", 10);
    await exact("Displayed", String(GHOST));
    expect(await num("Active")).toBe(activeBefore);
  });

  await test.step("box over the whole cloud by numeric inputs previews the ghost only", async () => {
    await ctl("tool-box").click();
    for (const [id, v] of [["box-center-x", 4.5], ["box-center-y", 4.5], ["box-center-z", 1.5], ["box-size-x", 12], ["box-size-y", 12], ["box-size-z", 6]] as const) {
      await setNum(id, v);
    }
    await exact("Candidates", String(GHOST));
    await exact("Protected", "0");
    await expect(ctl("apply")).toBeEnabled();
  });

  await test.step("apply deletes exactly the candidates; undo restores; redo repeats", async () => {
    await ctl("apply").click();
    await exact("Active", String(activeBefore - GHOST));
    await expect(ctl("undo")).toBeEnabled();
    await ctl("undo").click();
    await exact("Active", String(activeBefore));
    await expect(ctl("redo")).toBeEnabled();
    await ctl("redo").click();
    await exact("Active", String(activeBefore - GHOST));
    await ctl("undo").click();
    await exact("Active", String(activeBefore));
  });
  expect(errors).toEqual([]);
});

test("6c real UI: protection, stale preview, compare, export and session downloads, reopen, unsaved warning", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => {
    if (r.status() >= 400 && !(r.status() === 404 && new URL(r.url()).pathname === "/api/session")) {
      errors.push(`HTTP ${r.status()} ${r.url()}`);
    }
  });
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.type());
    void d.accept();
  });
  await page.goto("/");
  await page.locator("#file-input").setInputFiles({ name: "synthetic.pcd", mimeType: "application/octet-stream", buffer: syntheticPcd() });
  const status = page.locator("#statusbar");
  const stat = (name: string) => status.locator(`[data-status="${name}"]`);
  const exact = (name: string, v: number | string) => expect(stat(name)).toHaveText(new RegExp(`^${name.replace(/[()/]/g, "\\$&")}: ${v}$`), { timeout: 15000 });
  const num = async (name: string) => Number((await stat(name).innerText()).replace(/[^0-9]/g, ""));
  const ctl = (id: string) => page.locator(`[data-control="${id}"]`);
  const setNum = async (id: string, v: number) => {
    await ctl(id).fill(String(v));
    await ctl(id).press("Tab");
  };
  await exact("Displayed", String(FLOOR + GHOST));
  const activeBefore = await num("Active");
  await expect(page.locator("#unsaved-badge")).toHaveText("No unsaved edits");

  await test.step("E2E-03 box numbers preview exactly the ghost; Protected 0", async () => {
    await ctl("tool-box").click();
    for (const [id, v] of [["box-center-x", 4.5], ["box-center-y", 4.5], ["box-center-z", 1.5], ["box-size-x", 12], ["box-size-y", 12], ["box-size-z", 6]] as const) {
      await setNum(id, v);
    }
    await exact("Candidates", String(GHOST + FLOOR));
    await exact("Protected", "0");
  });

  await test.step("E2E-04 global protection around the floor retains the floor", async () => {
    await ctl("prot-enabled").check();
    await setNum("prot-min", -0.1);
    await setNum("prot-max", 0.1);
    await exact("Candidates", String(GHOST), );
    await exact("Protected", String(FLOOR));
    await expect(page.locator("#editpanels")).toContainText("retained by protection");
  });

  await test.step("E2E-06 a filter change makes the preview stale until a fresh one completes", async () => {
    await expect(ctl("apply")).toBeEnabled();
    await ctl("filter-z-enabled").check();
    await expect(ctl("apply")).toBeDisabled();
    await expect(ctl("apply")).toBeEnabled({ timeout: 15000 });
    await ctl("filter-z-enabled").uncheck();
    await expect(ctl("apply")).toBeDisabled();
    await expect(ctl("apply")).toBeEnabled({ timeout: 15000 });
    await exact("Candidates", String(GHOST));
  });

  await test.step("E2E-05 apply deletes exactly the candidates; unsaved badge; undo and redo", async () => {
    await page.screenshot({ path: "/out/editor.png" });
    await ctl("apply").click();
    await exact("Active", String(activeBefore - GHOST));
    await expect(page.locator("#unsaved-badge")).toHaveText("Unsaved edits");
    await ctl("undo").click();
    await exact("Active", String(activeBefore));
    await ctl("redo").click();
    await exact("Active", String(activeBefore - GHOST));
  });

  await test.step("E2E-07 comparison: overlay and split keep the exact counts; hold O shows the original", async () => {
    await ctl("compare-overlay").click();
    await expect(page.locator("#modebar")).toContainText("View: Overlay (read-only)");
    await expect(page.locator("#counts-panel")).toContainText(`Deleted${GHOST} (`);
    await expect(page.locator("#fileinfo")).toContainText(`Rendered all ${GHOST} eligible points`);
    await expect(ctl("apply")).toBeDisabled();
    await expect(ctl("tool-box")).toBeDisabled();
    await ctl("compare-split").click();
    await expect(page.locator("#modebar")).toContainText("View: Split (read-only)");
    await expect(page.locator("#fileinfo")).toContainText("Right drawn");
    await exact("Active", String(activeBefore - GHOST));
    await ctl("compare-edited").click();
    await expect(page.locator("#modebar")).not.toContainText("View:");
    await page.keyboard.down("o");
    await expect(page.locator("#modebar")).toContainText("View: Original (read-only)");
    await page.keyboard.up("o");
    await expect(page.locator("#modebar")).not.toContainText("View:");
    await exact("Active", String(activeBefore - GHOST));
    await ctl("tool-box").click(); // leave the tool
  });

  await test.step("AC-17 view state: colouring is stored with the session", async () => {
    const req = page.waitForRequest((r) => r.url().includes("attr=intensity"));
    await ctl("colour-mode").selectOption("intensity");
    await req;
    const put = page.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith("/api/session/client-state"));
    await put; // debounced one second after the last change
  });

  await test.step("E2E-08 export through the dialog; the download re-parses to fixture truth", async () => {
    await ctl("export").click();
    await expect(page.locator("#export-summary")).toContainText(`Exports all ${activeBefore - GHOST} active points`);
    await expect(page.locator("#export-scope")).toHaveValue("active");
    const [dl] = await Promise.all([page.waitForEvent("download"), ctl("export-go").click()]);
    expect(dl.suggestedFilename()).toBe("synthetic_cleaned.pcd");
    const path = testInfo.outputPath("export.pcd");
    await dl.saveAs(path);
    const parsed = parsePcd(readFileSync(path));
    expect(parsed.header.DATA).toBe("binary");
    expect(parsed.fields).toEqual(["x", "y", "z", "intensity"]);
    expect(parsed.rows.map(rowKey).sort()).toEqual(truthKeys(false));
    expect(parsed.rows.length).toBe(TOTAL - GHOST);
    await expect(page.locator("#notices")).toContainText("your browser decides where it is saved");
  });

  await test.step("E2E-09 unsaved edits warn before unload (real beforeunload dialog on a second tab)", async () => {
    const tab = await page.context().newPage();
    const seen: string[] = [];
    tab.on("dialog", (d) => {
      seen.push(d.type());
      void d.accept();
    });
    await tab.goto("/");
    await expect(tab.locator("#unsaved-badge")).toHaveText("Unsaved edits");
    await tab.locator("body").click(); // browsers only show the dialog after a user gesture
    await tab.reload();
    expect(seen).toContain("beforeunload");
    await tab.close();
  });

  await test.step("E2E-08 save session download (.pcdsession), then reopen it: same counts", async () => {
    const [dl] = await Promise.all([page.waitForEvent("download"), ctl("save-session").click()]);
    expect(dl.suggestedFilename()).toBe("synthetic_session_v1.pcdsession");
    const path = testInfo.outputPath("session.pcdsession");
    await dl.saveAs(path);
    await expect(page.locator("#unsaved-badge")).toHaveText("No unsaved edits");
    await expect(page.locator("#notices")).toContainText("Session download started");
    // another file replaces the open session, then the downloaded session is reopened through the picker
    await page.locator("#file-input").setInputFiles({ name: "other.pcd", mimeType: "application/octet-stream", buffer: syntheticPcd() });
    await exact("Active", String(TOTAL));
    await page.locator("#file-input").setInputFiles({ name: "synthetic_session_v1.pcdsession", mimeType: "application/octet-stream", buffer: readFileSync(path) });
    await exact("Original", String(TOTAL));
    await exact("Active", String(activeBefore - GHOST));
    await exact("Displayed", String(FLOOR));
    await expect(page.locator("#unsaved-badge")).toHaveText("No unsaved edits");
    await expect(ctl("undo")).toBeEnabled();
    await expect(ctl("colour-mode")).toHaveValue("intensity"); // restored from the archive's client state
  });

  await test.step("E2E-09 no warning when nothing is unsaved", async () => {
    dialogs.length = 0;
    await page.reload();
    await exact("Active", String(activeBefore - GHOST));
    expect(dialogs).not.toContain("beforeunload");
  });
  writeFileSync(testInfo.outputPath("done"), "ok");
  expect(errors).toEqual([]);
});

/** Shared helpers for the part 7 tests. */
function helpers(page: import("@playwright/test").Page) {
  const status = page.locator("#statusbar");
  const stat = (name: string) => status.locator(`[data-status="${name}"]`);
  const exact = (name: string, v: number | string) =>
    expect(stat(name)).toHaveText(new RegExp(`^${name.replace(/[()/]/g, "\\$&")}: ${v}$`), { timeout: 15000 });
  const num = async (name: string) => Number((await stat(name).innerText()).replace(/[^0-9]/g, ""));
  const ctl = (id: string) => page.locator(`[data-control="${id}"]`);
  const setNum = async (id: string, v: number) => {
    await ctl(id).fill(String(v));
    await ctl(id).press("Tab");
  };
  const boxEverything = async () => {
    for (const [id, v] of [["box-center-x", 4.5], ["box-center-y", 4.5], ["box-center-z", 1.5], ["box-size-x", 12], ["box-size-y", 12], ["box-size-z", 6]] as const) {
      await setNum(id, v);
    }
  };
  return { stat, exact, num, ctl, setNum, boxEverything };
}

test("E2E-10 7a filter redraws the canvas and a filter change never leaves a stale candidate (F-01, F-02, scope note)", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/");
  await page.locator("#file-input").setInputFiles({ name: "synthetic.pcd", mimeType: "application/octet-stream", buffer: syntheticPcd() });
  const { stat, exact, num, ctl, setNum, boxEverything } = helpers(page);
  await exact("Displayed", String(FLOOR + GHOST));
  const activeBefore = await num("Active");
  await ctl("tool-box").click();
  await boxEverything();
  await exact("Selected", String(FLOOR + GHOST));
  await exact("Candidates", String(FLOOR + GHOST));
  await page.waitForTimeout(500);
  const unfiltered = await page.locator("#viewport").screenshot();

  // watch every animation frame: Apply must never be enabled while a candidate larger than the displayed set is shown
  await page.evaluate(() => {
    const w = window as unknown as { __viol: string[] };
    w.__viol = [];
    const tick = () => {
      const a = document.querySelector('[data-control="apply"]') as HTMLButtonElement | null;
      const read = (n: string) => Number((document.querySelector(`[data-status="${n}"]`)?.textContent ?? "").replace(/[^0-9]/g, ""));
      // scope Displayed: an appliable candidate can never exceed what is displayed
      if (a && !a.disabled && read("Candidates") > read("Displayed")) w.__viol.push(`${read("Candidates")} > ${read("Displayed")}`);
      requestAnimationFrame(tick);
    };
    tick();
  });
  await ctl("filter-z-enabled").check();
  await setNum("filter-z-min", 0.5);
  await setNum("filter-z-max", 10);
  await exact("Displayed", String(GHOST));
  await expect(stat("Rendered")).toContainText(`Rendered all ${GHOST} eligible points`, { timeout: 15000 });
  await exact("Selected", String(GHOST));
  await exact("Candidates", String(GHOST));
  await expect(ctl("apply")).toBeEnabled({ timeout: 15000 });
  await page.waitForTimeout(500);
  const filtered = await page.locator("#viewport").screenshot();
  expect(Buffer.compare(unfiltered, filtered)).not.toBe(0); // F-01: the floor is gone from the canvas
  expect(await page.evaluate(() => (window as unknown as { __viol: string[] }).__viol)).toEqual([]);

  await ctl("apply").click();
  await exact("Active", String(activeBefore - GHOST)); // never 127 deleted
  await ctl("undo").click();
  await exact("Active", String(activeBefore));

  // scope Active keeps the hidden floor selected and says so
  await boxEverything();
  await page.locator('[data-control="scope-select"]').selectOption("active");
  await exact("Selected", String(FLOOR + GHOST));
  await expect(page.locator("#scope-note")).toContainText(`${FLOOR} selected points are outside the display filter`, { timeout: 15000 });
  expect(errors).toEqual([]);
});
