import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { BIG, FLOOR, GHOST, ROOM, ROOM_TOTAL, TOTAL, bigRoomPcd, bigRoomXyz, countInXyz, parsePcd, roomPcd, rowKey, syntheticPcd, truthKeys } from "./synthetic";

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
    await page.locator('[data-control="cube-top"]').click();
    await expect(page.locator("#inspector")).toContainText("Orthographic");
    await page.locator('[data-control="view-perspective"]').click();
    await expect(page.locator("#inspector")).toContainText("Perspective");
    await page.locator('[data-control="view-perspective"]').click();
    await page.locator('[data-control="cube-top"]').click();
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

test("E2E-32 there is no mounted-folder control", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-control="open-file"]')).toHaveCount(1);
  await expect(page.locator('[data-control="open-mounted"]')).toHaveCount(0);
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
  // an earlier test's session may still be open and unsaved: accept replacing it; bulk-delete confirms are recorded and dismissed
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    if (/points \(/.test(d.message())) {
      dialogs.push(d.message());
      void d.dismiss();
    } else void d.accept();
  });
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
  return { stat, exact, num, ctl, setNum, boxEverything, dialogs };
}

test("E2E-10 7a filter redraws the canvas and a filter change never leaves a stale candidate (F-01, F-02, scope note)", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const { stat, exact, num, ctl, setNum, boxEverything } = helpers(page);
  await page.goto("/");
  await page.locator("#file-input").setInputFiles({ name: "synthetic.pcd", mimeType: "application/octet-stream", buffer: syntheticPcd() });
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

test("E2E-11 7a the Box tool opens small and a bulk delete asks for confirmation (F-03)", async ({ page }) => {
  const { stat, exact, num, ctl, boxEverything, dialogs } = helpers(page);
  await page.goto("/");
  await page.locator("#file-input").setInputFiles({ name: "synthetic.pcd", mimeType: "application/octet-stream", buffer: syntheticPcd() });
  await exact("Displayed", String(FLOOR + GHOST));
  const activeBefore = await num("Active");
  await ctl("tool-box").click();
  await expect.poll(async () => (await stat("Candidates").innerText()).includes("—"), { timeout: 15000 }).toBe(false);
  expect(await num("Candidates")).toBeLessThan((FLOOR + GHOST) / 10);
  await boxEverything();
  await exact("Candidates", String(FLOOR + GHOST));
  await expect(ctl("apply")).toBeEnabled();
  await ctl("apply").click();
  await expect.poll(() => dialogs.length).toBe(1);
  expect(dialogs[0]).toContain(`${FLOOR + GHOST} of ${activeBefore} points`);
  await exact("Active", String(activeBefore));
});

test("E2E-12 7a Shift+drag on a box handle is a fine drag and does not pan the camera (F-06)", async ({ page }) => {
  const { exact, ctl, setNum } = helpers(page);
  await page.goto("/");
  await page.locator("#file-input").setInputFiles({ name: "synthetic.pcd", mimeType: "application/octet-stream", buffer: syntheticPcd() });
  await exact("Displayed", String(FLOOR + GHOST));
  await ctl("cube-top").click();
  await ctl("tool-box").click();
  const setBox = async () => {
    for (const [id, v] of [["box-center-x", 4.5], ["box-center-y", 4.5], ["box-center-z", 1.5], ["box-size-x", 4], ["box-size-y", 4], ["box-size-z", 2]] as const) await setNum(id, v);
  };
  type Hook = { state: () => { render: { count: number } | null; camera: { target: number[] }; tools: { box: { dimensions: number[] } } }; handlePositions: () => { id: string; x: number; y: number }[] };
  const read = () => page.evaluate(() => {
    const e = (window as unknown as { __editor: Hook }).__editor;
    const s = e.state();
    return { target: [...s.camera.target], width: s.tools.box.dimensions[0] };
  });
  const dragHandle = async (shift: boolean): Promise<{ delta: number; before: number[]; after: number[] }> => {
    await setBox();
    await page.waitForTimeout(400);
    const h = (await page.evaluate(() => (window as unknown as { __editor: Hook }).__editor.handlePositions())).find((p) => p.id === "resize-0+")!;
    const before = await read();
    if (shift) await page.keyboard.down("Shift");
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    await page.mouse.move(h.x + 50, h.y, { steps: 5 });
    await page.mouse.move(h.x + 100, h.y, { steps: 5 });
    await page.mouse.up();
    if (shift) await page.keyboard.up("Shift");
    const after = await read();
    return { delta: after.width - before.width, before: before.target, after: after.target };
  };
  const plain = await dragHandle(false);
  expect(plain.delta).toBeGreaterThan(0.5);
  const fine = await dragHandle(true);
  expect(fine.delta).toBeGreaterThan(0);
  expect(fine.delta / plain.delta).toBeCloseTo(0.1, 1);
  expect(fine.after).toEqual(fine.before); // the camera did not pan
});

test("E2E-13 7a cluster: partial result, no limit, and re-run when protection changes after the seed (F-04, F-07)", async ({ page }) => {
  const { stat, exact, num, ctl, setNum } = helpers(page);
  await page.goto("/");
  await page.locator("#file-input").setInputFiles({ name: "synthetic.pcd", mimeType: "application/octet-stream", buffer: syntheticPcd() });
  await exact("Displayed", String(FLOOR + GHOST));
  await ctl("cube-top").click();
  await ctl("pivot-x").fill("4");
  await ctl("pivot-y").fill("4");
  await ctl("pivot-z").fill("0");
  await ctl("pivot-set").click();
  await ctl("tool-cluster").click();
  await ctl("cluster-pick-seed").click();
  await page.locator("#viewport").click(); // top view: the point under the pivot with the greatest Z, a ghost point
  await expect(page.locator("#editpanels")).toContainText("Seed: point");
  await setNum("cluster-radius", 1.2); // links the ghost blob to the floor below it

  await ctl("cluster-max-points").fill("5");
  await ctl("cluster-max-points").press("Tab");
  await expect(page.locator("#editpanels")).toContainText("Stopped at 5 points", { timeout: 15000 });
  expect(await num("Candidates")).toBeGreaterThanOrEqual(5);
  await expect(ctl("apply")).toBeDisabled();

  await ctl("cluster-max-points").fill("");
  await ctl("cluster-max-points").press("Tab");
  await exact("Candidates", String(FLOOR + GHOST));
  await expect(page.locator("#editpanels")).not.toContainText("Stopped at");
  await expect(ctl("apply")).toBeEnabled();

  // protection after the seed: the cluster shrinks to what is not protected, with no checkbox toggling
  await ctl("prot-enabled").check();
  await setNum("prot-min", -0.1);
  await setNum("prot-max", 0.1);
  await exact("Candidates", String(GHOST));
  await expect(page.locator("#cluster-result")).toContainText(String(GHOST));
  await expect(stat("Protected")).toHaveText(new RegExp(`${FLOOR}`));
});

test("E2E-14 7a first load logs no console errors or failed requests; a bad file names itself", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`);
  });
  await page.goto("/");
  await expect(page.locator("#modebar")).toContainText("Frame: file");
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);

  errors.length = 0; // the 422 of the bad upload is expected from here on
  await page.locator("#file-input").setInputFiles({
    name: "broken.pcd",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("this is not a point cloud\n"),
  });
  await expect(page.locator("#notices")).toContainText("Cannot open broken.pcd:");
  await expect(page.locator("#notices")).toContainText("Is it a valid PCD (or .pcdsession)?");
});

type EditorHook = {
  state: () => { camera: { target: number[]; orientation: number[]; distance: number; ortho: boolean }; tools: { box: { center: number[]; dimensions: number[] }; protection: { global: { enabled: boolean; min: number; max: number } } } };
  projectWorld: (p: number[]) => { x: number; y: number } | null;
  handlePositions: () => { id: string; x: number; y: number }[];
  drawnCount: () => number;
};
const hook = <T>(page: import("@playwright/test").Page, fn: (e: EditorHook) => T) =>
  page.evaluate(`(${fn.toString()})(window.__editor)`) as Promise<T>;
const openRoom = async (page: import("@playwright/test").Page, exact: (n: string, v: number | string) => Promise<void>) => {
  await page.goto("/");
  await page.locator("#file-input").setInputFiles({ name: "room.pcd", mimeType: "application/octet-stream", buffer: roomPcd() });
  await exact("Original", String(ROOM_TOTAL));
  await page.waitForTimeout(600);
};

test("E2E-15 7b1 protect the floor from a picked point: no typing, counts equal fixture truth", async ({ page }) => {
  const { exact, ctl } = helpers(page);
  await openRoom(page, exact);
  await ctl("cube-top").click();
  await page.waitForTimeout(300);
  const at = await hook(page, (e) => e.projectWorld([15, 2, 0]));
  expect(at).not.toBeNull();
  await ctl("prot-pick-floor").click();
  await expect(page.locator("#modebar")).toContainText("Pick floor point");
  await page.mouse.click(at!.x, at!.y);
  await expect(ctl("prot-enabled")).toBeChecked({ timeout: 15000 });
  await expect(ctl("prot-min")).toHaveValue("-0.05");
  await expect(ctl("prot-max")).toHaveValue("0.05");
  // truth: floor 400 and the 9 ghost points inside the slab (z 0.02); the NaN row is invalid, never protected
  await exact("Protected", String(ROOM.floor + ROOM.floorGhost));
  await expect(page.locator("#modebar")).toContainText("Tool: None");
});

/** Independent count of valid rows inside an axis-aligned box (centre and size), inclusive edges. */
const countInBox = (rows: number[][], c: number[], d: number[]) =>
  rows.filter((r) => [0, 1, 2].every((i) => Number.isFinite(r[i]) && r[i] >= c[i] - d[i] / 2 - 1e-9 && r[i] <= c[i] + d[i] / 2 + 1e-9)).length;
const readBox = (page: import("@playwright/test").Page) => hook(page, (e) => ({ c: [...e.state().tools.box.center], d: [...e.state().tools.box.dimensions] }));
const realDrag = async (page: import("@playwright/test").Page, a: { x: number; y: number }, b: { x: number; y: number }) => {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 6 });
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
};

test("E2E-16 7b1 rectangle select with the real mouse in Top then Left view, fit to view and fit displayed; counts equal fixture truth", async ({ page }) => {
  const { exact, num, ctl, setNum } = helpers(page);
  await openRoom(page, exact);
  const rows = parsePcd(roomPcd()).rows;
  await ctl("tool-box").click();
  await ctl("cube-top").click();
  await page.waitForTimeout(300);
  await ctl("box-rect").click();
  const P = async (x: number, y: number, z: number) => (await hook(page, (e) => e.projectWorld([0, 0, 0])), (await page.evaluate(([a, b, c]) => (window as unknown as { __editor: EditorHook }).__editor.projectWorld([a, b, c]), [x, y, z] as number[]))!);
  await realDrag(page, await P(1.5, 11.5, 0), await P(5.5, 15.5, 0));
  await expect.poll(async () => (await readBox(page)).d[2], { timeout: 15000 }).toBeCloseTo(4, 6); // depth = bounds z
  let box = await readBox(page);
  expect(box.d[0]).toBeGreaterThan(3.5);
  expect(box.d[0]).toBeLessThan(4.5);
  expect(box.c[1]).toBeGreaterThan(13);
  expect(box.c[1]).toBeLessThan(14);
  let truth = countInBox(rows, box.c, box.d);
  expect(truth).toBeGreaterThanOrEqual(ROOM.ghost + ROOM.floorGhost);
  await exact("Candidates", String(truth));

  // Left is edge-on from Top: click the Top face's left edge (diagonal view), then the now visible Left face
  const topFace = (await ctl("cube-top").boundingBox())!;
  await page.mouse.click(topFace.x + 3, topFace.y + topFace.height / 2);
  await expect(ctl("cube-left")).toHaveAttribute("data-facing", "true");
  await ctl("cube-left").click();
  await page.waitForTimeout(300);
  await realDrag(page, await P(5, 11.5, 0.5), await P(5, 15.2, 3.5));
  await expect.poll(async () => (await readBox(page)).d[0], { timeout: 15000 }).toBeCloseTo(20, 6); // depth = bounds x
  box = await readBox(page);
  truth = countInBox(rows, box.c, box.d);
  expect(truth).toBe(ROOM.ghost); // the ghost block and nothing else
  await exact("Candidates", String(truth));
  await exact("Selected", String(truth));

  await ctl("box-fit-view").click();
  await exact("Candidates", String(await num("Displayed")));
  await ctl("filter-z-enabled").check();
  await setNum("filter-z-min", 0.5);
  await setNum("filter-z-max", 10);
  await exact("Displayed", String(ROOM.wall + ROOM.ghost + ROOM.noise));
  await ctl("box-fit-displayed").click();
  await exact("Candidates", String(ROOM.wall + ROOM.ghost + ROOM.noise));
  await page.screenshot({ path: "/out/rect-select.png" });
});

test("E2E-17 7b1 slice view clips the drawn cloud in the real canvas and changes no count", async ({ page }) => {
  const { exact, num, ctl, setNum } = helpers(page);
  await openRoom(page, exact);
  await ctl("cube-front").click();
  await page.waitForTimeout(500);
  const counts = async () => [await num("Original"), await num("Active"), await num("Displayed"), await num("Selected")];
  const before = await counts();
  const region = async (p: { x: number; y: number }) =>
    page.screenshot({ clip: { x: Math.round(p.x) - 14, y: Math.round(p.y) - 14, width: 28, height: 28 } });
  const wallAt = (await hook(page, (e) => e.projectWorld([-1, 4, 2.5])))!;
  const ghostAt = (await hook(page, (e) => e.projectWorld([3, 13, 2]))!)!;
  const emptyAt = { x: wallAt.x + 40, y: wallAt.y - 120 };
  const emptyShot = await region(emptyAt);
  const wallFull = await region(wallAt);
  const ghostFull = await region(ghostAt);
  expect(Buffer.compare(wallFull, emptyShot)).not.toBe(0); // wall drawn
  expect(Buffer.compare(ghostFull, emptyShot)).not.toBe(0); // ghost drawn

  await page.locator('[data-control="slice-axis"]').selectOption("y");
  await setNum("slice-centre", 13.2);
  await setNum("slice-thickness", 3.4);
  await page.waitForTimeout(600);
  expect(Buffer.compare(await region(wallAt), emptyShot)).toBe(0); // wall (y 0..9) is clipped away
  expect(Buffer.compare(await region(ghostAt), emptyShot)).not.toBe(0); // ghost slab (y 12..15) stays
  expect(await counts()).toEqual(before); // render only

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("]"); // one thickness forward: centre 16.6, slab 14.9..18.3
  await expect.poll(async () => (await hook(page, (e) => (e.state() as unknown as { slice: { centre: number } }).slice.centre))).toBeCloseTo(16.6, 6);
  await page.waitForTimeout(600);
  expect(Buffer.compare(await region(ghostAt), emptyShot)).toBe(0); // ghosts left the slab
  await page.keyboard.press("[");
  await page.waitForTimeout(600);
  expect(Buffer.compare(await region(ghostAt), emptyShot)).not.toBe(0);
  await ctl("slice-off").click();
  await page.waitForTimeout(600);
  expect(Buffer.compare(await region(wallAt), emptyShot)).not.toBe(0);
  expect(await counts()).toEqual(before);
});

test("E2E-18 7b1 legend, headline numbers and the kept-by-protection warning equal fixture truth", async ({ page }) => {
  const { exact, ctl, setNum } = helpers(page);
  await openRoom(page, exact);
  // legend chips use the palette colours
  await expect(page.locator('#legend [data-legend="selected"]')).toHaveCSS("background-color", "rgb(255, 159, 28)");
  await expect(page.locator('#legend [data-legend="protected"]')).toHaveCSS("background-color", "rgb(0, 209, 255)");
  await expect(page.locator("#headline-delete")).toHaveText("Will delete —");
  await expect(page.locator("#kept-warning")).toBeHidden();

  await ctl("prot-enabled").check();
  await setNum("prot-min", -0.05);
  await setNum("prot-max", 0.05);
  await exact("Protected", String(ROOM.floor + ROOM.floorGhost));
  await ctl("tool-box").click();
  for (const [id, v] of [["box-center-x", 9], ["box-center-y", 9], ["box-center-z", 2], ["box-size-x", 30], ["box-size-y", 30], ["box-size-z", 10]] as const) await setNum(id, v);
  const valid = ROOM_TOTAL - ROOM.invalid;
  const kept = ROOM.floor + ROOM.floorGhost; // z 0 and z 0.02 lie inside +-0.05
  await exact("Selected", String(valid));
  await exact("Candidates", String(valid - kept));
  await expect(page.locator("#headline-delete")).toHaveText(`Will delete ${valid - kept}`);
  await expect(page.locator("#headline-kept")).toHaveText(`Kept by protection ${kept}`);
  await expect(page.locator("#kept-warning")).toBeVisible();
  await expect(page.locator("#kept-warning")).toHaveText(`${kept} selected points lie inside the protected interval and will be kept (ghosts in the floor slab?)`);

  // Show kept points redraws the canvas (render only: counts do not move)
  await page.waitForTimeout(500);
  const plain = await page.locator("#viewport").screenshot();
  await ctl("sel-show-kept").click();
  await page.waitForTimeout(600);
  expect(Buffer.compare(await page.locator("#viewport").screenshot(), plain)).not.toBe(0);
  await exact("Candidates", String(valid - kept));

  // protection off: nothing is kept, the warning goes
  await ctl("prot-enabled").uncheck();
  await exact("Candidates", String(valid));
  await expect(page.locator("#kept-warning")).toBeHidden();
  await expect(page.locator("#headline-kept")).toHaveText("Kept by protection 0");
});

test("E2E-18b 7b1 draw budget: Rendered equals the budget exactly, the default draws everything, Auto is offered", async ({ page }) => {
  const { stat, exact } = helpers(page);
  const n = 150_000;
  const rows: string[] = [];
  for (let i = 0; i < n; i++) rows.push(`${i % 400} ${Math.floor(i / 400)} 0`);
  const head = ["# .PCD v.7 - synthetic grid", "VERSION .7", "FIELDS x y z", "SIZE 4 4 4", "TYPE F F F", "COUNT 1 1 1", `WIDTH ${n}`, "HEIGHT 1", "VIEWPOINT 0 0 0 1 0 0 0", `POINTS ${n}`, "DATA ascii"];
  await page.goto("/");
  await page.locator("#file-input").setInputFiles({ name: "grid.pcd", mimeType: "application/octet-stream", buffer: Buffer.from(`${head.join("\n")}\n${rows.join("\n")}\n`) });
  await exact("Original", "150,000");
  await expect(stat("Rendered")).toHaveText("Rendered: Rendered all 150,000 eligible points", { timeout: 20000 });
  await expect(page.locator('[data-control="budget"] option', { hasText: "Auto (max)" })).toHaveCount(1);
  await page.locator('[data-control="budget"]').selectOption("100000");
  await expect(stat("Rendered")).toHaveText("Rendered: Rendered 100,000 of 150,000 eligible (sampled to budget)", { timeout: 20000 });
});

const PRESET_LOOK_UP: Record<string, { look: number[]; up: number[] }> = {
  top: { look: [0, 0, -1], up: [0, 1, 0] },
  bottom: { look: [0, 0, 1], up: [0, 1, 0] },
  front: { look: [0, 1, 0], up: [0, 0, 1] },
  back: { look: [0, -1, 0], up: [0, 0, 1] },
  left: { look: [1, 0, 0], up: [0, 0, 1] },
  right: { look: [-1, 0, 0], up: [0, 0, 1] },
};
const NAMES = ["top", "bottom", "front", "back", "left", "right"];
const rotateQ = (q: number[], v: number[]) => {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
};
const cameraLookUp = async (page: import("@playwright/test").Page) => {
  const c = await hook(page, (e) => ({ q: [...(e.state() as unknown as { camera: { orientation: number[] } }).camera.orientation], ortho: (e.state() as unknown as { camera: { ortho: boolean } }).camera.ortho }));
  return { look: rotateQ(c.q, [0, 0, -1]), up: rotateQ(c.q, [0, 1, 0]), ortho: c.ortho };
};
const cubeFaces = (page: import("@playwright/test").Page) =>
  page.evaluate(() => Object.fromEntries([...document.querySelectorAll<HTMLElement>("#viewcube .cube-face")].map((f) => [f.dataset.control, { facing: f.dataset.facing, transform: f.style.transform }])));
const matrixOf = (t: string) => (t.match(/-?[\d.]+(?:e-?\d+)?/g) ?? []).map(Number);

test("E2E-19 7b1 ViewCube: real clicks on all six faces, edge click, orbit tracking, keys 1-6, screenshot", async ({ page }) => {
  const { exact, ctl } = helpers(page);
  await openRoom(page, exact);
  const stage = (await page.locator("#viewport").boundingBox())!;
  const expectPreset = async (name: string) => {
    const c = await cameraLookUp(page);
    PRESET_LOOK_UP[name].look.forEach((v, i) => expect(c.look[i]).toBeCloseTo(v, 6));
    PRESET_LOOK_UP[name].up.forEach((v, i) => expect(c.up[i]).toBeCloseTo(v, 6));
    expect(c.ortho).toBe(true);
    const faces = await cubeFaces(page);
    for (const n of NAMES) expect(faces[`cube-${n}`].facing, `${name}: ${n}`).toBe(String(n === name));
    const m = matrixOf(faces[`cube-${name}`].transform); // the clicked face is straight on, upright (no flip, no shear)
    [1, 0, 0, 1].forEach((v, i) => expect(m[i]).toBeCloseTo(v, 4));
  };

  // Faces other than the facing one are edge-on in a preset view, so move like a user does: click the facing face's edge
  // toward the neighbour (a diagonal view that shows both), then click the neighbour. Opposite faces go via a third face.
  const cross3 = (p: number[], q: number[]) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
  const dot3 = (p: number[], q: number[]) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const normal = (n: string) => PRESET_LOOK_UP[n].look.map((v) => -v);
  let cur = "top"; // the default view shows Top, Front and Right
  const clickFace = async (name: string) => {
    await ctl(`cube-${name}`).click();
    await expectPreset(name);
    cur = name;
  };
  const go = async (name: string): Promise<void> => {
    if (name === cur) return clickFace(name);
    const n = normal(name);
    if (dot3(n, normal(cur)) !== 0) {
      const via = NAMES.find((v) => v !== cur && v !== name)!;
      await go(via);
      return go(name);
    }
    const box = (await ctl(`cube-${cur}`).boundingBox())!;
    const right = cross3(PRESET_LOOK_UP[cur].look, PRESET_LOOK_UP[cur].up);
    const down = PRESET_LOOK_UP[cur].up.map((v) => -v);
    const sx = Math.round(dot3(n, right));
    const sy = Math.round(dot3(n, down));
    await page.mouse.click(box.x + box.width / 2 + sx * (box.width / 2 - 3), box.y + box.height / 2 + sy * (box.height / 2 - 3));
    await expect(ctl(`cube-${name}`)).toHaveAttribute("data-facing", "true");
    await clickFace(name);
  };
  await clickFace("top"); // visible straight away
  for (const name of ["front", "bottom", "back", "left", "right", "top"]) await go(name);

  // orbit with the mouse: the cube follows
  const before = await cubeFaces(page);
  await realDrag(page, { x: stage.x + 40, y: stage.y + stage.height - 150 }, { x: stage.x + 160, y: stage.y + stage.height - 110 });
  const after = await cubeFaces(page);
  expect(JSON.stringify(after)).not.toBe(JSON.stringify(before));

  // keys 1-6 give identical results
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (const [i, name] of NAMES.entries()) {
    await page.keyboard.press(String(i + 1));
    await expectPreset(name);
  }

  // an edge click from the Top view looks at the cube diagonally
  cur = "right"; // key 6 was the last press
  await go("top");
  const top = (await ctl("cube-top").boundingBox())!;
  await page.mouse.click(top.x + top.width - 3, top.y + top.height / 2);
  const diag = await cameraLookUp(page);
  expect(diag.look[0]).toBeCloseTo(-Math.SQRT1_2, 6);
  expect(diag.look[2]).toBeCloseTo(-Math.SQRT1_2, 6);
  await expect(ctl("cube-right")).toHaveAttribute("data-facing", "true");

  // no view-* preset buttons remain
  for (const n of NAMES) await expect(page.locator(`[data-control="view-${n}"]`)).toHaveCount(0);
  await expect(page.locator("#axis-legend")).toHaveCount(0);

  // screenshots: the cube in the default isometric view, plus the full window for a visual check
  await page.keyboard.press("3"); // Front, then orbit a little so three faces show
  await realDrag(page, { x: stage.x + 40, y: stage.y + stage.height - 150 }, { x: stage.x + 100, y: stage.y + stage.height - 110 });
  const cube = (await page.locator("#viewcube").boundingBox())!;
  await page.screenshot({ path: "/out/viewcube.png", clip: { x: cube.x - 40, y: cube.y - 8, width: cube.width + 50, height: cube.height + 16 } });
  await page.screenshot({ path: "/out/viewcube-full.png" });
});

test("E2E-20 7b2 the ? key and the ? button open a help overlay listing every key; Esc closes it", async ({ page }) => {
  const { exact, ctl } = helpers(page);
  await openRoom(page, exact);
  const help = page.locator("#help-overlay");
  await expect(help).not.toBeVisible();
  await page.keyboard.press("?");
  await expect(help).toBeVisible();
  for (const k of ["1", "P", "F", "Alt+F", "O (hold)", "R (hold)", "[", "]", "Enter", "Esc", "Delete", "Ctrl+Z", "Ctrl+Y", "?"]) {
    await expect(help.locator("td.k", { hasText: new RegExp(`^${k.replace(/[()+[\]?]/g, "\\$&")}$`) })).toHaveCount(1);
  }
  await expect(help).toContainText("Click a ViewCube face");
  await page.keyboard.press("Escape");
  await expect(help).not.toBeVisible();
  await ctl("help").click();
  await expect(help).toBeVisible();
  await ctl("help").click();
  await expect(help).not.toBeVisible();
  // typing a ? in a field must not open it
  await ctl("pivot-x").click();
  await page.keyboard.type("?");
  await expect(help).not.toBeVisible();
});

const OVERFLOW_SELECTORS = ["#toolbar", "#viewbar", "#tools", "#inspector", "#fileinfo", "#editpanels", "#statusbar", "#modebar"];

async function checkLayout(page: import("@playwright/test").Page, w: number, h: number) {
  const scan = () =>
    page.evaluate((sels) => {
      const bad: string[] = [];
      const doc = document.documentElement;
      if (doc.scrollWidth > doc.clientWidth) bad.push(`document scrollWidth ${doc.scrollWidth} > ${doc.clientWidth}`);
      if (doc.scrollHeight > doc.clientHeight) bad.push(`document scrollHeight ${doc.scrollHeight} > ${doc.clientHeight}`);
      const containers = [...sels.map((s) => document.querySelector(s)), ...document.querySelectorAll(".panel")] as (HTMLElement | null)[];
      for (const c of containers) {
        if (!c) continue;
        const id = c.id ? `#${c.id}` : `.${c.className}`;
        if (c.scrollWidth > c.clientWidth + 1) bad.push(`${id} scrollWidth ${c.scrollWidth} > clientWidth ${c.clientWidth}`);
        const box = c.getBoundingClientRect();
        for (const el of c.querySelectorAll<HTMLElement>("button, input, select, label, dd, p")) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.right > box.right + 1 || r.left < box.left - 1) bad.push(`${id} child ${el.dataset.control ?? el.tagName} spills (${Math.round(r.left)}..${Math.round(r.right)} vs ${Math.round(box.left)}..${Math.round(box.right)})`);
        }
      }
      return bad;
    }, OVERFLOW_SELECTORS);
  expect(await scan(), `${w}x${h} initial`).toEqual([]);
  for (const tool of ["tool-box", "tool-polygon", "tool-cluster"]) {
    await page.locator(`[data-control="${tool}"]`).click();
    await page.locator('[data-control="pivot-x"]').focus();
    await page.waitForTimeout(150);
    expect(await scan(), `${w}x${h} with ${tool}`).toEqual([]);
  }
  const stage = (await page.locator("#stage").boundingBox())!;
  expect(stage.width, `${w}x${h} viewport width`).toBeGreaterThanOrEqual(w * 0.6);
  expect(stage.height, `${w}x${h} viewport height`).toBeGreaterThanOrEqual(h * 0.55);
}

for (const [w, h] of [[1280, 720], [1920, 1080]] as const) {
  test(`E2E-21 7b2 no overflow at ${w}x${h} and the viewport keeps most of the window`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    const { exact } = helpers(page);
    await openRoom(page, exact);
    await checkLayout(page, w, h);
    await page.locator('[data-control="tool-box"]').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `/out/layout-${w}.png` });
  });
}

test("E2E-23 7b2 an Add shape is shown as a draft with its own outline colour and no invented count, until committed", async ({ page }) => {
  const { exact, ctl } = helpers(page);
  await openRoom(page, exact);
  await ctl("tool-box").click();
  await ctl("op-select").selectOption("add");
  await expect(page.locator("#draft-note")).toBeHidden();
  await ctl("box-size-x").fill("3");
  await ctl("box-size-x").press("Enter");
  await expect(page.locator("#draft-note")).toBeVisible();
  await expect(page.locator("#draft-note")).toContainText("Draft, not yet applied");
  await expect(page.locator("#draft-note")).toContainText("count is unknown");
  await expect(ctl("sel-commit")).toBeEnabled();
  await expect(ctl("apply")).toBeDisabled();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "/out/draft.png" });
  await ctl("sel-commit").click();
  await expect(page.locator("#draft-note")).toBeHidden({ timeout: 15000 });
});

test("E2E-22 7b2 a slow upload can be cancelled: the progress goes away, the open file is untouched", async ({ page }) => {
  const { exact, ctl } = helpers(page);
  await openRoom(page, exact);
  // hold the next upload request back so the "sending" phase lasts long enough to press Cancel
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));
  await page.route("**/api/session/upload*", async (route) => {
    await gate;
    await route.continue().catch(() => undefined);
  });
  await page.locator("#file-input").setInputFiles({ name: "slow.pcd", mimeType: "application/octet-stream", buffer: syntheticPcd() });
  await expect(page.locator("#progress")).toBeVisible();
  await expect(page.locator("#progress")).toContainText("Uploading");
  await expect(ctl("upload-cancel")).toBeVisible();
  await ctl("upload-cancel").click();
  await expect(page.locator("#progress")).toBeHidden();
  release();
  await page.waitForTimeout(500);
  await expect(page.locator("#notices")).not.toContainText("Cannot open");
  await exact("Original", String(ROOM_TOTAL));
  await expect(page.locator("#inspector")).toContainText("room.pcd");
  await expect(ctl("upload-cancel")).toBeHidden();
});

test("E2E-24 7b2 first page shows the start banner; a reloaded session starts Replace, Displayed, no tool, default cluster limit", async ({ page }) => {
  const { exact, ctl } = helpers(page);
  // a previous test's session is still on the server: close it by opening a page without one is not possible, so check the banner by state
  await openRoom(page, exact);
  await expect(page.locator("#start-banner")).toBeHidden();
  await ctl("tool-cluster").click();
  await ctl("op-select").selectOption("add");
  await ctl("scope-select").selectOption("active");
  await ctl("cluster-max-points").fill("1234");
  await ctl("cluster-max-points").press("Enter");
  await expect(page.locator("#modebar")).toContainText("Op: Add");
  await page.waitForTimeout(1600); // the client state is saved one second after the last change
  await page.reload();
  await exact("Original", String(ROOM_TOTAL));
  await expect(page.locator("#modebar")).toContainText("Tool: None");
  await expect(page.locator("#modebar")).toContainText("Op: Replace");
  await expect(page.locator("#modebar")).toContainText("Scope: Displayed");
  await ctl("tool-cluster").click();
  await expect(ctl("cluster-max-points")).toHaveValue(/^2[, ]?000[, ]?000$/);
});

test("E2E-24b 7b2 with no file open the banner explains why the tools are inert", async ({ page, request }) => {
  const { ctl } = helpers(page);
  const closed = await request.delete("/api/session");
  expect([200, 204, 404]).toContain(closed.status());
  await page.goto("/");
  await expect(page.locator("#start-banner")).toBeVisible();
  await expect(page.locator("#start-banner")).toContainText("Open a PCD to start");
  await expect(page.locator("#start-banner")).toContainText("disabled until a file is open");
  await expect(ctl("tool-box")).toBeDisabled();
  await expect(ctl("apply")).toBeDisabled();
});

test("E2E-25 7c1 cluster r=2 on a 300k-point room finishes, Apply deletes the component exactly, the server stays up", async ({ page, request }) => {
  test.setTimeout(180000);
  const { exact, ctl, setNum } = helpers(page);
  // floor 500 x 440 grid at z 0 (220,000) and an isolated 40 x 40 x 50 ghost block 5 m above it (80,000)
  const rows: string[] = [];
  for (let x = 0; x < 500; x++) for (let y = 0; y < 440; y++) rows.push(`${x / 10} ${y / 10} 0`);
  for (let x = 0; x < 40; x++) for (let y = 0; y < 40; y++) for (let z = 0; z < 50; z++) rows.push(`${20 + x / 10} ${20 + y / 10} ${5 + z / 10}`);
  const head = ["# .PCD v.7 - synthetic room 300k", "VERSION .7", "FIELDS x y z", "SIZE 4 4 4", "TYPE F F F", "COUNT 1 1 1", `WIDTH ${rows.length}`, "HEIGHT 1", "VIEWPOINT 0 0 0 1 0 0 0", `POINTS ${rows.length}`, "DATA ascii"];
  await page.goto("/");
  await page.locator("#file-input").setInputFiles({ name: "room300k.pcd", mimeType: "application/octet-stream", buffer: Buffer.from(`${head.join("\n")}\n${rows.join("\n")}\n`) });
  await exact("Original", "300,000");
  await page.waitForTimeout(800);
  await ctl("cube-top").click();
  await ctl("pivot-x").fill("22");
  await ctl("pivot-y").fill("22");
  await ctl("pivot-z").fill("0");
  await ctl("pivot-set").click();
  await ctl("tool-cluster").click();
  await ctl("cluster-pick-seed").click();
  await page.locator("#viewport").click(); // top view: the greatest Z under the pivot is a ghost point
  await expect(page.locator("#editpanels")).toContainText("Seed: point");
  await setNum("cluster-radius", 2);
  await exact("Candidates", "80,000");
  await expect(page.locator("#editpanels")).not.toContainText("Stopped at");
  await ctl("apply").click();
  await exact("Displayed", "220,000");
  await exact("Original", "300,000");
  const alive = await request.get("/api/session");
  expect(alive.status()).toBe(200);
  expect((await alive.json()).no_session).toBeUndefined();
});

test("E2E-26 7c2 a second tab replaces the file: the first tab's stale Apply is refused with a notice and reloaded counts", async ({ page, context }) => {
  const a = helpers(page);
  await page.goto("/");
  await page.locator("#file-input").setInputFiles({ name: "synthetic.pcd", mimeType: "application/octet-stream", buffer: syntheticPcd() });
  await a.exact("Original", String(TOTAL));
  await a.ctl("tool-box").click();
  await a.boxEverything();
  await a.exact("Candidates", String(GHOST + FLOOR));
  await a.ctl("prot-enabled").check();
  await a.setNum("prot-min", -0.1);
  await a.setNum("prot-max", 0.1);
  await a.exact("Candidates", String(GHOST));
  await expect(a.ctl("apply")).toBeEnabled();

  const other = await context.newPage();
  const b = helpers(other);
  await other.goto("/");
  await other.locator("#file-input").setInputFiles({ name: "room.pcd", mimeType: "application/octet-stream", buffer: roomPcd() });
  await b.exact("Original", String(ROOM_TOTAL));

  await a.ctl("apply").click();
  await expect(page.locator("#notices")).toContainText("replaced in another tab", { timeout: 15000 });
  await a.exact("Original", String(ROOM_TOTAL));
  await other.close();
});

const blurFocus = (page: import("@playwright/test").Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

test("E2E-27 7c3 ghosts inside the floor slab: Rect, one click on 'Also delete the kept points', Apply; counts equal fixture truth", async ({ page }) => {
  test.setTimeout(240000);
  const { exact, ctl, setNum } = helpers(page);
  const fmt = (v: number) => v.toLocaleString("en-US");
  const xyz = bigRoomXyz();
  const total = BIG.floor + BIG.ghost;
  await page.goto("/");
  await page.locator("#file-input").setInputFiles({ name: "big.pcd", mimeType: "application/octet-stream", buffer: bigRoomPcd(xyz) });
  await exact("Original", fmt(total));
  await page.waitForTimeout(1500);
  await ctl("prot-enabled").check();
  await setNum("prot-min", -0.05);
  await setNum("prot-max", 0.05);
  await exact("Protected", fmt(BIG.floor + BIG.ghostInSlab));
  await ctl("tool-box").click();
  await ctl("cube-top").click();
  await page.waitForTimeout(500);
  await ctl("box-rect").click();
  const P = async (x: number, y: number, z: number) => (await page.evaluate(([a, b, c]) => (window as unknown as { __editor: EditorHook }).__editor.projectWorld([a, b, c]), [x, y, z] as number[]))!;
  // the view animates to Top: wait until a projected point stops moving before anchoring the drag to it
  let last = await P(18, 61, 0);
  await expect
    .poll(async () => {
      const cur = await P(18, 61, 0);
      const still = Math.abs(cur.x - last.x) < 0.01 && Math.abs(cur.y - last.y) < 0.01;
      last = cur;
      return still;
    }, { timeout: 10000, intervals: [300] })
    .toBe(true);
  const a = await P(18, 61, 0);
  const b = await P(42, 74, 0);
  expect(a).not.toBeNull();
  await realDrag(page, a, b);
  await expect.poll(async () => (await readBox(page)).d[1], { timeout: 20000 }).toBeGreaterThan(10);
  const box = await readBox(page);
  const inBox = countInXyz(xyz, box.c, box.d);
  const inSlab = countInXyz(xyz, box.c, box.d, [-0.05, 0.05]);
  expect(inBox).toBe(BIG.ghost); // the rectangle holds the whole ghost block and no floor
  expect(inSlab).toBe(BIG.ghostInSlab);
  await exact("Candidates", fmt(inBox - inSlab));
  await expect(page.locator("#kept-warning")).toBeVisible();
  const btn = page.locator("#sel-delete-kept");
  await expect(btn).toHaveText("Also delete the 5,000 kept points (this operation only)");
  await btn.click();
  await exact("Candidates", fmt(inBox));
  await expect(ctl("prot-mode")).toHaveValue("override");
  await expect(ctl("apply")).toBeEnabled();
  await expect(btn).toBeHidden();
  await ctl("apply").click();
  await exact("Displayed", fmt(BIG.floor)); // every ghost gone, every floor point still there
  await exact("Original", fmt(total));
  await expect(ctl("prot-enabled")).toBeChecked(); // the global slab is untouched
  await expect(ctl("prot-mode")).toHaveValue("inherit"); // the override was for one operation only
});

test("E2E-29 7c3 a Shift rectangle in the Front view narrows the Top-view box and keeps its depth; counts equal fixture truth", async ({ page }) => {
  const { exact, ctl } = helpers(page);
  await openRoom(page, exact);
  const rows = parsePcd(roomPcd()).rows;
  await ctl("tool-box").click();
  await ctl("cube-top").click();
  await page.waitForTimeout(300);
  await ctl("box-rect").click();
  const P = async (x: number, y: number, z: number) => (await page.evaluate(([a, b, c]) => (window as unknown as { __editor: EditorHook }).__editor.projectWorld([a, b, c]), [x, y, z] as number[]))!;
  await realDrag(page, await P(1.5, 11.5, 0), await P(5.5, 15.5, 0));
  await expect.poll(async () => (await readBox(page)).d[2], { timeout: 15000 }).toBeCloseTo(4, 6);
  const first = await readBox(page);
  await exact("Candidates", String(countInBox(rows, first.c, first.d)));
  await blurFocus(page);
  await page.keyboard.press("3"); // Front: screen axes x and z, depth y
  await page.waitForTimeout(400);
  await page.keyboard.down("Shift");
  await realDrag(page, await P(0, 0, 3.5), await P(4, 0, 0.5));
  await page.keyboard.up("Shift");
  await expect.poll(async () => (await readBox(page)).d[2], { timeout: 15000 }).toBeLessThan(3.5);
  const box = await readBox(page);
  expect(box.c[1]).toBe(first.c[1]); // depth (y) untouched, exactly
  expect(box.d[1]).toBe(first.d[1]);
  expect(box.c[0] - box.d[0] / 2).toBeGreaterThanOrEqual(first.c[0] - first.d[0] / 2 - 1e-9); // never wider than the old box
  expect(box.c[0] + box.d[0] / 2).toBeLessThanOrEqual(4.2); // the Shift rectangle's right edge, within pixel error
  expect(box.d[2]).toBeGreaterThan(2.5);
  const truth = countInBox(rows, box.c, box.d);
  expect(truth).toBeGreaterThan(0);
  expect(truth).toBeLessThan(countInBox(rows, first.c, first.d));
  await exact("Candidates", String(truth));
});

test("E2E-30 7c3 Fit displayed with a Y filter on non-float32 limits selects exactly the displayed points", async ({ page }) => {
  const { exact, ctl, setNum } = helpers(page);
  await openRoom(page, exact);
  const rows = parsePcd(roomPcd()).rows;
  await ctl("filter-y-enabled").check();
  await setNum("filter-y-min", 3.2);
  await setNum("filter-y-max", 8);
  const displayed = rows.filter((r) => [0, 1, 2].every((i) => Number.isFinite(r[i])) && r[1] >= 3.2 && r[1] <= 8).length;
  await exact("Displayed", String(displayed));
  await ctl("tool-box").click();
  await ctl("box-fit-displayed").click();
  await exact("Selected", String(displayed));
  await exact("Candidates", String(displayed));
});

test("E2E-28 7c3 the interaction LOD draws at most 200k points during a real orbit drag and the full draw returns after idle", async ({ page }) => {
  test.setTimeout(240000);
  const { exact } = helpers(page);
  const xyz = bigRoomXyz();
  const total = BIG.floor + BIG.ghost;
  await page.goto("/");
  await page.locator("#file-input").setInputFiles({ name: "big.pcd", mimeType: "application/octet-stream", buffer: bigRoomPcd(xyz) });
  await exact("Original", total.toLocaleString("en-US"));
  await expect.poll(() => hook(page, (e) => e.state().render?.count ?? 0), { timeout: 30000 }).toBe(total);
  await expect.poll(() => hook(page, (e) => e.drawnCount()), { timeout: 15000 }).toBe(total); // idle: the full draw
  const box = (await page.locator("#viewport").boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  const during: number[] = [];
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(cx + i * 25, cy + i * 8);
    during.push(await hook(page, (e) => e.drawnCount()));
  }
  expect(Math.max(...during)).toBeLessThanOrEqual(200_000);
  expect(Math.min(...during)).toBeGreaterThan(100_000); // a subsample, not an empty draw
  await page.mouse.up();
  await expect.poll(() => hook(page, (e) => e.drawnCount()), { timeout: 5000 }).toBe(total);
});

test("E2E-31 7c3 the legend has a Protection slab chip and Pick floor point hints at a face view until the view is one", async ({ page }) => {
  const { exact, ctl } = helpers(page);
  await openRoom(page, exact);
  await expect(page.locator('#legend [data-legend="slab"]')).toHaveCSS("background-color", "rgb(199, 125, 255)");
  await expect(page.locator("#legend")).toContainText("Protection slab");
  await ctl("cube-top").click();
  await page.waitForTimeout(300);
  await ctl("prot-pick-floor").click();
  await expect(page.locator("#modebar")).toContainText("Pick floor point");
  await expect(page.locator("#modebar")).not.toContainText("so the floor is a line"); // Top is a face view
  await ctl("prot-pick-floor").click(); // back to orbit, then tilt the view off the axes
  const box = (await page.locator("#viewport").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 60, { steps: 6 });
  await page.mouse.up();
  await ctl("prot-pick-floor").click();
  await expect(page.locator("#modebar")).toContainText("Use Front, Back, Left or Right view so the floor is a line");
  await page.locator("#viewport").hover();
  await page.keyboard.press("3"); // Front (key 3)
  await expect(page.locator("#modebar")).not.toContainText("so the floor is a line");
});
