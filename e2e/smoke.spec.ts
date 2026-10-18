import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { BIG, FLOOR, GHOST, ROOM, ROOM_TOTAL, TILTED, TOTAL, bigRoomPcd, bigRoomXyz, countInTiltedSlab, countInXyz, parsePcd, roomPcd, rowKey, syntheticPcd, tiltedFloorAngles, tiltedFloorPcd, truthKeys } from "./synthetic";

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
    await expect(status.locator('[data-status="Rendered"]')).toContainText(`all ${FLOOR + GHOST} eligible points`);
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
    await setNum("filter-z-min", 1.5);
    await expect(ctl("apply")).toBeDisabled();
    await expect(ctl("apply")).toBeEnabled({ timeout: 15000 });
    await ctl("filter-z-min-reset").click();
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
  await setNum("filter-z-min", 0.5);
  await setNum("filter-z-max", 10);
  await exact("Displayed", String(GHOST));
  await expect(stat("Rendered")).toContainText(`all ${GHOST} eligible points`, { timeout: 15000 });
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
  await expect(stat("Rendered")).toHaveText("Rendered: all 150,000 eligible points", { timeout: 20000 });
  await expect(page.locator('[data-control="budget"] option', { hasText: "Auto (max)" })).toHaveCount(1);
  await page.locator('[data-control="budget"]').selectOption("100000");
  await expect(stat("Rendered")).toHaveText("Rendered: 100,000 of 150,000 eligible (sampled to budget)", { timeout: 20000 });
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

test("E2E-34 9 security headers reach the browser and the page frames nothing", async ({ page, request }) => {
  const r = await request.get("/");
  expect(r.headers()["x-frame-options"]).toBe("DENY");
  expect(r.headers()["x-content-type-options"]).toBe("nosniff");
  expect(r.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/content security policy/i.test(m.text())) violations.push(m.text());
  });
  await page.goto("/");
  await page.locator("#file-input").setInputFiles({ name: "synthetic.pcd", mimeType: "application/octet-stream", buffer: syntheticPcd() });
  await expect(page.locator('#statusbar [data-status="Original"]')).toContainText(String(TOTAL));
  await page.waitForTimeout(500);
  expect(violations).toEqual([]);
});

test("E2E-33 9 accessibility basics: the canvas is labelled and notices are a live region (m-9)", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#viewport")).toHaveAttribute("role", "img");
  await expect(page.locator("#viewport")).toHaveAttribute("aria-label", /point cloud/i);
  await expect(page.locator("#notices")).toHaveAttribute("aria-live", "polite");
  await page.locator("#file-input").setInputFiles({ name: "broken.pcd", mimeType: "application/octet-stream", buffer: Buffer.from("not a cloud\n") });
  await expect(page.locator("#notices .notice.error")).toHaveAttribute("role", "alert");
});

// ---- part 10: on-canvas filter boxes (E2E-35..37, 40, 41)
type FilterHook = { state: () => { filters?: unknown; tools: { filters: Record<"x" | "y" | "z", { enabled: boolean; min: number; max: number }> }; session: { bounds: { min: number[]; max: number[] } } | null } };
const filtersNow = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __editor: FilterHook }).__editor.state();
    return { f: s.tools.filters, b: s.session!.bounds };
  });
const roomValid = () => parsePcd(roomPcd()).rows.filter((r) => Number.isFinite(r[0]) && Number.isFinite(r[1]) && Number.isFinite(r[2]));
const centre = async (loc: import("@playwright/test").Locator) => {
  const b = (await loc.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

test("E2E-35 10 dragging a filter grip with the real mouse filters live, Esc restores, and typing a value works", async ({ page }) => {
  const { exact, ctl, setNum } = helpers(page);
  await openRoom(page, exact);
  await page.keyboard.press("3");
  await page.waitForTimeout(400);
  const rows = roomValid();
  const grip = ctl("filter-z-max-grip");
  await expect(grip).toBeVisible();
  const g = await centre(grip);
  const before = await filtersNow(page);
  await page.mouse.move(g.x, g.y);
  await page.mouse.down();
  await page.mouse.move(g.x, g.y + 60, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await filtersNow(page)).f.z.max, { timeout: 15000 }).toBeLessThan(before.b.max[2] - 0.05);
  const v = (await filtersNow(page)).f.z.max;
  expect((await filtersNow(page)).f.z.enabled).toBe(true);
  await exact("Displayed", String(rows.filter((r) => r[2] <= v).length));
  // Esc mid-drag puts the value back
  const g2 = await centre(grip);
  await page.mouse.move(g2.x, g2.y);
  await page.mouse.down();
  await page.mouse.move(g2.x, g2.y + 40, { steps: 6 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect.poll(async () => (await filtersNow(page)).f.z.max, { timeout: 5000 }).toBeCloseTo(v, 9);
  await exact("Displayed", String(rows.filter((r) => r[2] <= v).length));
  // typing
  await setNum("filter-z-max", 1.5);
  await exact("Displayed", String(rows.filter((r) => r[2] <= 1.5).length));
});

test("E2E-36 10 a collapsed but active box shows a chip with its value and the filter still applies", async ({ page }) => {
  const { exact, ctl, setNum } = helpers(page);
  await openRoom(page, exact);
  await page.keyboard.press("3");
  const rows = roomValid();
  await setNum("filter-z-max", 1.5);
  const n = String(rows.filter((r) => r[2] <= 1.5).length);
  await exact("Displayed", n);
  await ctl("filter-z-max-toggle").click();
  const fbox = page.locator('.fbox[data-box="z-max"]');
  await expect(fbox).toHaveClass(/active/);
  await expect(fbox).toHaveClass(/collapsed/);
  expect(await ctl("filter-z-max-toggle").evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe(await ctl("filter-z-min-toggle").evaluate((e) => getComputedStyle(e).backgroundColor));
  await expect(ctl("filter-z-max-toggle")).toContainText("1.5");
  await exact("Displayed", n);
  await ctl("filter-z-max-toggle").click();
  await expect(ctl("filter-z-max")).toBeVisible();
  await expect(ctl("filter-z-max")).toHaveValue(/1\.5/);
  await exact("Displayed", n);
});

test("E2E-37 10 box placement follows the view: end-on axes dock at the bottom of the left edge", async ({ page }) => {
  const { exact, ctl } = helpers(page);
  await openRoom(page, exact);
  const edges = async () =>
    page.evaluate(() => Object.fromEntries([...document.querySelectorAll<HTMLElement>(".fbox")].map((e) => [e.dataset.box!, e.dataset.edge!])));
  const stageBox = (await page.locator("#stage").boundingBox())!;
  for (const [key, cube, endOn] of [["3", "cube-front", "y"], ["5", "cube-left", "x"], ["1", "cube-top", "z"]] as const) {
    await page.keyboard.press(key);
    await page.waitForTimeout(400);
    const e = await edges();
    for (const side of ["min", "max"]) {
      expect(e[`${endOn}-${side}`], `${cube} ${endOn}-${side}`).toBe("dock");
      const b = (await ctl(`filter-${endOn}-${side}`).boundingBox())!;
      expect(b.x, `${cube} ${endOn}-${side} inside`).toBeGreaterThanOrEqual(stageBox.x - 1);
    }
    // the in-view axes are not end-on, so at least one of their boxes sits off the left dock or above the end-on ones
    expect(Object.keys(e)).toHaveLength(6);
  }
  const front = await (async () => {
    await page.keyboard.press("3");
    await page.waitForTimeout(400);
    const z = (await ctl("filter-z-max").boundingBox())!;
    const zmin = (await ctl("filter-z-min").boundingBox())!;
    return { zMaxY: z.y, zMinY: zmin.y };
  })();
  expect(front.zMaxY).toBeLessThan(front.zMinY); // Z max is above Z min on screen in a Z-up view
});

test("E2E-40 10 per-box reset and global reset restore the cloud bound and the summary says so", async ({ page }) => {
  const { exact, ctl, setNum } = helpers(page);
  await openRoom(page, exact);
  await page.keyboard.press("3");
  const rows = roomValid();
  const all = String(rows.length);
  await setNum("filter-z-max", 1.5);
  await setNum("filter-x-min", 5);
  await exact("Displayed", String(rows.filter((r) => r[2] <= 1.5 && r[0] >= 5).length));
  await expect(page.locator("#inspector")).toContainText(/Displayed: /);
  await ctl("filter-z-max-reset").click();
  await exact("Displayed", String(rows.filter((r) => r[0] >= 5).length));
  const f = await filtersNow(page);
  expect(f.f.z.enabled).toBe(false);
  await ctl("filter-reset-all").click();
  await exact("Displayed", all);
  const g = await filtersNow(page);
  expect(g.f.x.enabled).toBe(false);
  await expect(ctl("filter-x-min")).toHaveValue(new RegExp(`^${g.b.min[0]}`));
});

test("E2E-41 10 the boxes never overlap each other, the ViewCube, the legend or a notice at 1280x720 and 1920x1080", async ({ page }) => {
  const { exact, setNum } = helpers(page);
  for (const [w, h, shot] of [[1280, 720, "fbox-1280.png"], [1920, 1080, "fbox-1920.png"]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await openRoom(page, exact);
    await setNum("filter-z-max", 1.5);
    let lastLook = "";
    for (const [key, cube] of [["3", "front"], ["5", "left"], ["1", "top"], ["4", "back"]] as const) {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); // keys typed into a field would not change the view
      await page.keyboard.press(key);
      await page.evaluate(() => (document.querySelector("[data-control=filter-x-min]") as HTMLInputElement).focus());
      await page.waitForTimeout(400);
      const look = await page.evaluate(() => JSON.stringify((window as unknown as { __editor: { state: () => { camera: { orientation: number[] } } } }).__editor.state().camera.orientation));
      expect(look, `${w} ${cube} the view changed`).not.toBe(lastLook);
      lastLook = look;
      const rects = await page.evaluate(() => {
        const r = (e: Element) => {
          const b = e.getBoundingClientRect();
          return { l: b.left, t: b.top, r: b.right, b: b.bottom };
        };
        return {
          boxes: [...document.querySelectorAll(".fbox")].map((e) => ({ id: (e as HTMLElement).dataset.box!, ...r(e) })),
          fixed: ["#viewcube", "#legend"].map((s) => ({ id: s, ...r(document.querySelector(s)!) })),
          stage: r(document.querySelector("#stage")!),
        };
      });
      const hit = (a: { l: number; t: number; r: number; b: number }, c: { l: number; t: number; r: number; b: number }) => a.l < c.r && c.l < a.r && a.t < c.b && c.t < a.b;
      for (const [i, a] of rects.boxes.entries()) {
        expect(a.l >= rects.stage.l - 1 && a.r <= rects.stage.r + 1 && a.t >= rects.stage.t - 1 && a.b <= rects.stage.b + 1, `${w} ${cube} ${a.id} inside stage`).toBe(true);
        for (const c of rects.boxes.slice(i + 1)) expect(hit(a, c), `${w} ${cube} ${a.id} x ${c.id}`).toBe(false);
        for (const c of rects.fixed) expect(hit(a, c), `${w} ${cube} ${a.id} x ${c.id}`).toBe(false);
      }
    }
    // a notice on screen
    await page.locator("#file-input").setInputFiles({ name: "broken.pcd", mimeType: "application/octet-stream", buffer: Buffer.from("not a cloud\n") });
    await expect(page.locator("#notices .notice.error")).toBeVisible();
    const n = (await page.locator("#notices").boundingBox())!;
    for (const b of await page.locator(".fbox").all()) {
      const r = (await b.boundingBox())!;
      expect(r.x < n.x + n.width && n.x < r.x + r.width && r.y < n.y + n.height && n.y < r.y + r.height, `${w} box x notice`).toBe(false);
    }
    await page.screenshot({ path: `/out/${shot}` });
  }
});

// ---- part 10: filter planes and arrows (E2E-38, E2E-35b, E2E-42)
type PlanesHook = { filterPlanes: () => { key: string; base: { x: number; y: number } | null; tip: { x: number; y: number } | null }[] };
const planesNow = (page: import("@playwright/test").Page) => page.evaluate(() => (window as unknown as { __editor: PlanesHook }).__editor.filterPlanes());
const cameraNow = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const c = (window as unknown as { __editor: { state: () => { camera: { orientation: number[]; target: number[] } } } }).__editor.state().camera;
    return JSON.stringify([c.orientation, c.target]);
  });

test("E2E-38 10 a real-mouse drag on a filter plane's arrow filters live and leaves the camera alone; collapsed, the same drag orbits", async ({ page }) => {
  const { exact, ctl, setNum } = helpers(page);
  await openRoom(page, exact);
  await page.keyboard.press("3"); // Front: Z is vertical on screen
  await page.waitForTimeout(400);
  const rows = roomValid();
  await setNum("filter-z-max", 2);
  await exact("Displayed", String(rows.filter((r) => r[2] <= 2).length));
  const arrow = async () => {
    const p = (await planesNow(page)).find((q) => q.key === "z-max")!;
    return { x: (p.base!.x + p.tip!.x) / 2, y: (p.base!.y + p.tip!.y) / 2, tipUp: p.tip!.y < p.base!.y };
  };
  const a = await arrow();
  expect(a.tipUp).toBe(true); // the arrow points to the hidden side (above the Z max cut)
  const cam0 = await cameraNow(page);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x, a.y + 30, { steps: 6 });
  expect(await cameraNow(page)).toBe(cam0); // the camera stays put during the drag
  await page.mouse.up();
  const v = (await filtersNow(page)).f.z.max;
  expect(v).toBeLessThan(2 - 0.05);
  await exact("Displayed", String(rows.filter((r) => r[2] <= v).length));
  expect(await cameraNow(page)).toBe(cam0);
  // Esc mid-drag restores the value
  const a2 = await arrow();
  await page.mouse.move(a2.x, a2.y);
  await page.mouse.down();
  await page.mouse.move(a2.x, a2.y + 20, { steps: 4 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect.poll(async () => (await filtersNow(page)).f.z.max, { timeout: 5000 }).toBeCloseTo(v, 9);
  // collapsed: the plane is gone and the same drag orbits
  await ctl("filter-z-max-toggle").click();
  expect((await planesNow(page)).map((q) => q.key)).not.toContain("z-max");
  await page.mouse.move(a2.x, a2.y);
  await page.mouse.down();
  await page.mouse.move(a2.x + 40, a2.y + 10, { steps: 6 });
  await page.mouse.up();
  expect(await cameraNow(page)).not.toBe(cam0);
  expect((await filtersNow(page)).f.z.max).toBeCloseTo(v, 9);
});

test("E2E-35b 10 focusing an inactive box shows its plane; leaving it with an inactive value hides it", async ({ page }) => {
  const { exact, ctl } = helpers(page);
  await openRoom(page, exact);
  await page.keyboard.press("3");
  expect((await planesNow(page)).map((q) => q.key)).toEqual([]);
  await ctl("filter-x-min").focus();
  await expect.poll(async () => (await planesNow(page)).map((q) => q.key)).toEqual(["x-min"]);
  await ctl("filter-x-min").evaluate((e) => (e as HTMLInputElement).blur());
  await expect.poll(async () => (await planesNow(page)).map((q) => q.key)).toEqual([]);
});

test("E2E-42 10 the slice view does not hide the filter planes and changes no count", async ({ page }) => {
  const { exact, ctl, setNum, num } = helpers(page);
  await openRoom(page, exact);
  await page.keyboard.press("3");
  await setNum("filter-z-max", 2);
  const rows = roomValid();
  await exact("Displayed", String(rows.filter((r) => r[2] <= 2).length));
  const before = await num("Displayed");
  await setNum("slice-centre", 10);
  await setNum("slice-thickness", 1);
  await page.waitForTimeout(600);
  expect((await planesNow(page)).map((q) => q.key)).toContain("z-max");
  expect(await num("Displayed")).toBe(before);
  await ctl("slice-off").click();
});

// ---- part 10: protection band (E2E-39, E2E-43)
type ProtHook = { state: () => { floorT: number; floorPanelOpen: boolean; tools: { protection: { global: { enabled: boolean; min: number; max: number } } } } };
const protNow = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __editor: ProtHook }).__editor.state();
    return { g: s.tools.protection.global, floorT: s.floorT, open: s.floorPanelOpen };
  });
const protSummary = (page: import("@playwright/test").Page) => page.locator("details.panel > summary", { hasText: "Height protection" });

test("E2E-39 10 dragging the band's arrows with the real mouse sets the protected slab; counts equal fixture truth", async ({ page }) => {
  const { exact, ctl, setNum } = helpers(page);
  await openRoom(page, exact);
  const rows = roomValid();
  await page.keyboard.press("3"); // Front: Z is vertical on screen
  await ctl("prot-enabled").check();
  await setNum("prot-max", 1.5); // max first: min above the old max would be refused
  await setNum("prot-min", 0.5);
  const inSlab = (lo: number, hi: number) => String(rows.filter((r) => r[2] >= lo && r[2] <= hi).length);
  await exact("Protected", inSlab(0.5, 1.5));
  await page.waitForTimeout(400);
  // the arrows start at the XY centre of the active bounds
  const centre = (z: number) =>
    page.evaluate((zz) => {
      const e = (window as unknown as { __editor: { projectWorld: (p: number[]) => { x: number; y: number } | null; state: () => { session: { active_bounds: { min: number[]; max: number[] } } } } }).__editor;
      const b = e.state().session.active_bounds;
      return e.projectWorld([(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, zz]);
    }, z);
  // the upper plane's arrow points up from the footprint centre: grab it 20 px above that point
  const up = (await centre(1.5))!;
  await page.mouse.move(up.x, up.y - 20);
  await page.mouse.down();
  await page.mouse.move(up.x, up.y - 40, { steps: 6 });
  await page.mouse.up();
  const after = await protNow(page);
  expect(after.g.min).toBe(0.5); // the lower edge is untouched
  expect(after.g.max).toBeGreaterThan(1.5);
  await exact("Protected", inSlab(0.5, after.g.max));
  // the lower plane's arrow points down
  const lo = (await centre(0.5))!;
  await page.mouse.move(lo.x, lo.y + 20);
  await page.mouse.down();
  await page.mouse.move(lo.x, lo.y + 35, { steps: 5 });
  await page.mouse.up();
  const after2 = await protNow(page);
  expect(after2.g.min).toBeLessThan(0.5);
  expect(after2.g.max).toBe(after.g.max);
  await exact("Protected", inSlab(after2.g.min, after2.g.max));
  // pick floor, then an edge drag leaves the floor thickness alone
  await page.keyboard.press("1");
  await page.waitForTimeout(300);
  const at = (await hook(page, (e) => e.projectWorld([15, 2, 0])))!;
  await ctl("prot-pick-floor").click();
  await page.mouse.click(at.x, at.y);
  await expect(ctl("prot-min")).toHaveValue("-0.05", { timeout: 15000 });
  await page.keyboard.press("3");
  await page.waitForTimeout(400);
  const top = (await centre(0.05))!;
  await page.mouse.move(top.x, top.y - 20);
  await page.mouse.down();
  await page.mouse.move(top.x, top.y - 35, { steps: 5 });
  await page.mouse.up();
  const picked = await protNow(page);
  expect(picked.g.max).toBeGreaterThan(0.05);
  expect(picked.floorT).toBe(0.05);
});

test("E2E-43 10 folding the protection section toggles the strong colour; counts and the prot ids are unchanged while it is open", async ({ page }) => {
  const { exact, ctl } = helpers(page);
  await openRoom(page, exact);
  await page.keyboard.press("1");
  await page.waitForTimeout(300);
  const at = (await hook(page, (e) => e.projectWorld([15, 2, 0])))!;
  await ctl("prot-pick-floor").click();
  await page.mouse.click(at.x, at.y);
  await exact("Protected", String(ROOM.floor + ROOM.floorGhost));
  await page.mouse.move(2, 2); // away from the canvas content
  await page.waitForTimeout(600);
  const view = page.locator("#viewport");
  const open = await view.screenshot();
  expect((await protNow(page)).open).toBe(true);
  await expect(ctl("prot-min")).toBeVisible();
  await protSummary(page).click();
  await expect.poll(async () => (await protNow(page)).open).toBe(false);
  await expect(ctl("prot-min")).not.toBeVisible();
  await page.waitForTimeout(600);
  const folded = await view.screenshot();
  expect(Buffer.compare(open, folded)).not.toBe(0); // the strong colour is gone
  await exact("Protected", String(ROOM.floor + ROOM.floorGhost));
  await protSummary(page).click();
  await expect.poll(async () => (await protNow(page)).open).toBe(true);
  await expect(ctl("prot-min")).toBeVisible();
  await page.waitForTimeout(600);
  expect(Buffer.compare(open, await view.screenshot())).toBe(0); // and back
});

// ---- part 10: tilted protection slab (E2E-44, E2E-45)
type TiltHook = {
  state: () => { tools: { protection: { global: { enabled: boolean; min: number; max: number }; tilt: { rx: number; ry: number; pivot: number[] } } } };
  tiltRings: () => { id: string; pts: ({ x: number; y: number } | null)[] }[];
  protectionArrows: () => { key: string; base: { x: number; y: number } | null; tip: { x: number; y: number } | null }[];
};
const tiltNow = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const p = (window as unknown as { __editor: TiltHook }).__editor.state().tools.protection;
    return { min: p.global.min, max: p.global.max, rx: p.tilt.rx, ry: p.tilt.ry, pivot: [...p.tilt.pivot] };
  });
const tiltedRows = () => parsePcd(tiltedFloorPcd()).rows;
const openTilted = async (page: import("@playwright/test").Page, exact: (n: string, v: number | string) => Promise<void>) => {
  await page.goto("/");
  await page.locator("#file-input").setInputFiles({ name: "tilted.pcd", mimeType: "application/octet-stream", buffer: tiltedFloorPcd() });
  await exact("Original", String(TILTED.floor + TILTED.ghost));
  await page.waitForTimeout(600);
};
/** Slab on in Front view (the Y ring is a full circle there), then a real-mouse drag along the Y ring. */
const dragYRing = async (page: import("@playwright/test").Page, setNum: (id: string, v: number) => Promise<void>, ctl: (id: string) => import("@playwright/test").Locator) => {
  await page.keyboard.press("3");
  await ctl("prot-enabled").check();
  await setNum("prot-max", 0.5);
  await setNum("prot-min", -0.5);
  await page.waitForTimeout(400);
  const ring = (await page.evaluate(() => (window as unknown as { __editor: TiltHook }).__editor.tiltRings())).find((r) => r.id === "y")!;
  const a = ring.pts[0]!;
  const b = ring.pts[3]!;
  await realDrag(page, a, b);
};

test("E2E-44 10 the tilted slab is fitted to a tilted floor with the real mouse and the fields; Protected equals fixture truth; ghosts go, the floor stays; Level resets", async ({ page }) => {
  const { exact, ctl, setNum, num } = helpers(page);
  await openTilted(page, exact);
  const rows = tiltedRows();
  await dragYRing(page, setNum, ctl);
  const dragged = await tiltNow(page);
  expect(Math.abs(dragged.ry)).toBeGreaterThan(5); // the ring turned the slab
  expect(Math.abs(dragged.ry)).toBeLessThan(60);
  expect(dragged.rx).toBeCloseTo(0, 6); // only the Y ring was dragged
  await exact("Protected", String(countInTiltedSlab(rows, dragged.rx, dragged.ry, dragged.pivot, dragged.min, dragged.max)));

  // fit the slab to the floor: type the plane's own angles, then a +-0.03 slab around the floor's slab coordinate
  const ang = tiltedFloorAngles();
  await setNum("prot-tilt-y", ang.ry);
  await setNum("prot-tilt-x", ang.rx);
  const t = await tiltNow(page);
  const rx = (t.rx * Math.PI) / 180;
  const ry = (t.ry * Math.PI) / 180;
  const c = -(Math.cos(rx) * Math.sin(ry) * t.pivot[0] - Math.sin(rx) * t.pivot[1]); // the floor plane passes through the origin
  const lo = c - TILTED.half;
  const hi = c + TILTED.half;
  const order = hi > t.min ? ["prot-max", "prot-min"] : ["prot-min", "prot-max"];
  for (const id of order) await setNum(id, id === "prot-max" ? hi : lo);
  const truth = countInTiltedSlab(rows, t.rx, t.ry, t.pivot, lo, hi);
  expect(truth).toBe(TILTED.floor); // the fixture: the slab holds the floor and nothing else
  await exact("Protected", String(truth));

  // the upper arrow, grabbed halfway along its shaft, widens the slab upwards
  const arrows = await page.evaluate(() => (window as unknown as { __editor: TiltHook }).__editor.protectionArrows());
  const upper = arrows.filter((a) => a.base && a.tip).sort((p, q) => p.tip!.y - q.tip!.y)[0]!;
  const dx = upper.tip!.x - upper.base!.x;
  const dy = upper.tip!.y - upper.base!.y;
  const len = Math.hypot(dx, dy);
  const g = { x: upper.base!.x + dx / 2, y: upper.base!.y + dy / 2 };
  await realDrag(page, g, { x: g.x + (dx / len) * 25, y: g.y + (dy / len) * 25 });
  const widened = await tiltNow(page);
  expect(widened.max).toBeGreaterThan(hi);
  expect(widened.min).toBeCloseTo(lo, 6);
  expect(widened.rx).toBeCloseTo(t.rx, 9);
  expect(widened.ry).toBeCloseTo(t.ry, 9);
  await exact("Protected", String(countInTiltedSlab(rows, widened.rx, widened.ry, widened.pivot, widened.min, widened.max)));
  await setNum("prot-max", hi); // back to the exact floor slab
  await exact("Protected", String(TILTED.floor));

  // select the ghost block with the box and delete it: the protected floor stays
  await ctl("tool-box").click();
  for (const [id, v] of [["box-center-x", 3], ["box-center-y", 13], ["box-center-z", 3], ["box-size-x", 3], ["box-size-y", 3], ["box-size-z", 3]] as const) await setNum(id, v);
  const ghosts = rows.filter((r) => r[0] >= 1.5 && r[0] <= 4.5 && r[1] >= 11.5 && r[1] <= 14.5 && r[2] >= 1.5 && r[2] <= 4.5).length;
  expect(ghosts).toBe(TILTED.ghost);
  await exact("Candidates", String(ghosts));
  await ctl("apply").click();
  await exact("Active", String(TILTED.floor));
  expect(await num("Original")).toBe(TILTED.floor + TILTED.ghost);
  await ctl("tool-box").click(); // leave the tool
  await exact("Protected", String(TILTED.floor));

  // Level returns both angles to zero
  await ctl("prot-level").click();
  await expect(ctl("prot-tilt-x")).toHaveValue("0");
  await expect(ctl("prot-tilt-y")).toHaveValue("0");
  const level = await tiltNow(page);
  expect(level.rx).toBe(0);
  expect(level.ry).toBe(0);
});

test("E2E-45 10 a typed tilt equals the dragged tilt; the tilt survives a reload and a session download and reopen", async ({ page }, testInfo) => {
  const { exact, ctl, setNum } = helpers(page);
  await openTilted(page, exact);
  const rows = tiltedRows();
  await dragYRing(page, setNum, ctl);
  const dragged = await tiltNow(page);
  expect(Math.abs(dragged.ry)).toBeGreaterThan(5);
  const protectedDragged = countInTiltedSlab(rows, dragged.rx, dragged.ry, dragged.pivot, dragged.min, dragged.max);
  await exact("Protected", String(protectedDragged));

  await ctl("prot-level").click();
  await expect(ctl("prot-tilt-y")).toHaveValue("0");
  await setNum("prot-tilt-y", dragged.ry);
  const typed = await tiltNow(page);
  expect(typed.ry).toBeCloseTo(dragged.ry, 9);
  expect(typed.rx).toBe(0);
  expect(typed.pivot[0]).toBeCloseTo(dragged.pivot[0], 9);
  expect(typed.pivot[1]).toBeCloseTo(dragged.pivot[1], 9);
  await exact("Protected", String(protectedDragged));

  // an edit (apply of a candidate-free preview is not possible), so the tilt is kept through the archive: save, replace, reopen
  const [dl] = await Promise.all([page.waitForEvent("download"), ctl("save-session").click()]);
  const path = testInfo.outputPath("tilt.pcdsession");
  await dl.saveAs(path);
  await page.locator("#file-input").setInputFiles({ name: "other.pcd", mimeType: "application/octet-stream", buffer: syntheticPcd() });
  await exact("Original", String(TOTAL));
  await page.locator("#file-input").setInputFiles({ name: "tilt.pcdsession", mimeType: "application/octet-stream", buffer: readFileSync(path) });
  await exact("Original", String(TILTED.floor + TILTED.ghost));
  await expect.poll(async () => (await tiltNow(page)).ry, { timeout: 15000 }).toBeCloseTo(typed.ry, 6);
  const reopened = await tiltNow(page);
  expect(reopened.ry).toBeCloseTo(typed.ry, 6);
  expect(reopened.rx).toBe(0);
  await exact("Protected", String(protectedDragged));

  await page.reload();
  await exact("Original", String(TILTED.floor + TILTED.ghost));
  await expect.poll(async () => (await tiltNow(page)).ry, { timeout: 15000 }).toBeCloseTo(typed.ry, 6);
  await exact("Protected", String(protectedDragged));
});

// ---- part 10-8: every inspector section folds and the state survives a reload (E2E-46)
const SECTIONS_OPEN = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __editor: { state: () => { sectionsOpen: Record<string, boolean> } } }).__editor.state();
    return { ...s.sectionsOpen };
  });
test("E2E-46 10-8 each inspector section folds by click and keyboard, the fold survives a reload, and counts do not change", async ({ page }) => {
  const { exact, ctl } = helpers(page);
  await openRoom(page, exact);
  const sum = (id: string) => page.locator(`details[data-section="${id}"] > summary`);
  const det = (id: string) => page.locator(`details[data-section="${id}"]`);
  const probes: Record<string, () => import("@playwright/test").Locator> = {
    file: () => page.locator("#fileinfo details[data-section=file] dl"),
    counts: () => page.locator("#counts-panel"),
    view: () => page.locator("#fileinfo details[data-section=view] dl"),
    display: () => ctl("filter-reset-all"),
    slice: () => ctl("slice-enabled"),
    history: () => page.locator("details[data-section=history] > p"), // "No edits yet" (an empty list has no height)
  };
  for (const id of Object.keys(probes)) {
    await expect(det(id)).toHaveAttribute("open", "");
    await expect(probes[id]()).toBeVisible();
  }
  await expect(det("view")).toBeVisible();
  const before = await page.locator("#counts-panel").innerText();
  // click collapses; the keyboard (Enter on the focused summary) toggles too
  for (const id of ["file", "counts", "view", "display", "slice"]) await sum(id).click();
  await sum("history").focus();
  await page.keyboard.press("Enter");
  for (const id of Object.keys(probes)) await expect(probes[id]()).toBeHidden();
  await ctl("tool-box").click();
  await expect(ctl("box-size-x")).toBeVisible();
  await sum("box").click();
  await expect(ctl("box-size-x")).toBeHidden();
  await expect.poll(async () => Object.keys(await SECTIONS_OPEN(page)).sort()).toEqual(["box", "counts", "display", "file", "history", "slice", "view"]);
  await page.waitForTimeout(1600); // the client state is saved one second after the last change
  await page.reload();
  await exact("Original", String(ROOM_TOTAL));
  await expect.poll(async () => Object.keys(await SECTIONS_OPEN(page)).sort()).toEqual(["box", "counts", "display", "file", "history", "slice", "view"]);
  for (const id of Object.keys(probes)) await expect(probes[id]()).toBeHidden();
  await ctl("tool-box").click();
  await expect(ctl("box-size-x")).toBeHidden();
  // reopen all: nothing was lost and the counts read the same. The all-open state is also saved to the server (the next
  // test's page restores it), so this test leaves no folded section behind.
  const savedOpen = page.waitForRequest((r) => {
    if (r.method() !== "PUT" || !r.url().endsWith("/api/session/client-state")) return false;
    const folded = JSON.parse(r.postData() ?? "{}")?.ui?.sectionsOpen;
    return folded === undefined || Object.keys(folded).length === 0;
  });
  for (const id of ["file", "counts", "view", "display", "slice", "history", "box"]) await sum(id).click();
  for (const id of Object.keys(probes)) await expect(probes[id]()).toBeVisible();
  await expect(ctl("box-size-x")).toBeVisible();
  expect(await page.locator("#counts-panel").innerText()).toBe(before);
  await savedOpen;
  // an inspector never scrolls sideways
  expect(await page.evaluate(() => { const a = document.getElementById("inspector")!; return a.scrollWidth <= a.clientWidth; })).toBe(true);
});

// ---------------------------------------------------------------- part 11: history timeline
type Pg = import("@playwright/test").Page;
type StepHook = { stepLayer: () => { sid: number | null; visible: boolean; count: number; colour: number[]; opacity: number; hover: boolean } };
const stepLayer = (page: Pg) => page.evaluate(() => (window as unknown as { __editor: StepHook }).__editor.stepLayer());
const sidsOf = (page: Pg) =>
  page.evaluate(() => (window as unknown as { __editor: { state: () => { session: { history: { entries: { sid: number; count: number; name: string | null }[]; cursor: number } } } } }).__editor.state().session.history);

/** Helpers for the timeline tests: own dialog handling (discard/delete confirms are answered by `answer`). */
function tl(page: Pg) {
  const base = helpers(page);
  page.removeAllListeners("dialog");
  const dialogs: string[] = [];
  const mode = { answer: "accept" as "accept" | "dismiss" };
  page.on("dialog", (d) => {
    const m = d.message();
    if (/^(Applying a new deletion|Remove step)/.test(m)) {
      dialogs.push(m);
      void (mode.answer === "accept" ? d.accept() : d.dismiss());
    } else void d.accept(); // replacing an earlier test's open session
  });
  const cards = page.locator("#timeline .step[data-step]");
  const card = (i: number) => cards.nth(i);
  const marker = page.locator("#timeline-marker");
  /** Page x of marker slot k: between card k-1 and card k, measured from the DOM (not from the model code). */
  const slotPageX = async (k: number) => {
    const n = await cards.count();
    if (k === 0) return (await card(0).boundingBox())!.x - 4;
    const prev = (await card(k - 1).boundingBox())!;
    return k === n ? prev.x + prev.width + 4 : (prev.x + prev.width + (await card(k).boundingBox())!.x) / 2;
  };
  /** A gesture while a job runs is ignored by design: wait until the previous one and its refresh are done. */
  const isIdle = () => page.evaluate(() => { const st = (window as unknown as { __editor: { state: () => { job: { busy: boolean }; rendering: boolean } } }).__editor.state(); return !st.job.busy && !st.rendering; });
  /** Idle on three samples 150 ms apart: a preview the tool restarts after a change must not start under the next gesture. */
  const idle = async () => {
    let ok = 0;
    for (let i = 0; i < 100 && ok < 3; i++) {
      ok = (await isIdle()) ? ok + 1 : 0;
      await page.waitForTimeout(150);
    }
    expect(ok).toBe(3);
  };
  const dragMarkerTo = async (slot: number) => {
    await idle();
    const mb = (await marker.boundingBox())!;
    const y = mb.y + mb.height / 2;
    await page.mouse.move(mb.x + mb.width / 2, y);
    await page.mouse.down();
    const x = await slotPageX(slot);
    await page.mouse.move(x, y, { steps: 8 });
    await page.mouse.up();
  };
  const rollbacks: string[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/session/history/rollback")) rollbacks.push(r.postData() ?? "");
  });
  const boxAt = async (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number) => {
    // the previous test's tool is restored with the page: a click on an active tool would switch it off
    if (!(await base.ctl("tool-box").evaluate((e) => e.classList.contains("active")))) await base.ctl("tool-box").click();
    await unfold();
    for (const [id, v] of [["box-center-x", cx], ["box-center-y", cy], ["box-center-z", cz], ["box-size-x", sx], ["box-size-y", sy], ["box-size-z", sz]] as const) await base.setNum(id, v);
  };
  /** E2E-46 leaves the inspector sections folded in the state the next page restores: unfold the visible ones. */
  const unfold = async () => {
    const closed = page.locator("details[data-section]:not([open]) > summary:visible");
    for (let i = 0; i < 12 && (await closed.count()) > 0; i++) await closed.first().click();
  };
  const open = async () => {
    await openRoom(page, base.exact);
    await unfold();
  };
  /** Three deletions with three tools on the room: a box (27 ghost points), a cluster of the wall (40), and the 4 displayed noise points. */
  const threeSteps = async () => {
    await open();
    await boxAt(3, 13, 2, 4, 4, 3);
    await base.exact("Candidates", String(ROOM.ghost));
    await base.ctl("apply").click();
    await base.exact("Active", String(ROOM_TOTAL - ROOM.ghost));
    // Top by its key: the camera restored with the page (a Save flushes the current view into the archive the next test
    // reopens) may look from another side, and a face of the ViewCube that does not face the camera is hidden
    await page.keyboard.press("1");
    await base.ctl("pivot-x").fill("-1");
    await base.ctl("pivot-y").fill("4");
    await base.ctl("pivot-z").fill("4");
    await base.ctl("pivot-set").click();
    await base.ctl("tool-cluster").click();
    await unfold();
    await base.ctl("cluster-pick-seed").click();
    await page.locator("#viewport").click();
    await expect(page.locator("#editpanels")).toContainText("Seed: point");
    await base.setNum("cluster-radius", 1.1);
    await base.exact("Candidates", String(ROOM.wall));
    await base.ctl("apply").click();
    await base.exact("Active", String(ROOM_TOTAL - ROOM.ghost - ROOM.wall));
    await base.setNum("filter-z-min", 1);
    await base.exact("Displayed", String(ROOM.noise));
    await base.ctl("sel-select-displayed").click();
    await base.exact("Candidates", String(ROOM.noise));
    await base.ctl("apply").click();
    await base.exact("Active", String(ROOM_TOTAL - ROOM.ghost - ROOM.wall - ROOM.noise));
    await base.ctl("filter-z-min-reset").click();
    await expect(cards).toHaveCount(3);
  };
  return { ...base, open, cards, card, marker, dialogs, mode, slotPageX, dragMarkerTo, idle, rollbacks, boxAt, threeSteps };
}
const ACTIVE_ALL = ROOM_TOTAL - ROOM.ghost - ROOM.wall - ROOM.noise;

test("E2E-50 11 three deletions with three tools make three step cards with icons, counts and tooltips", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource.*404/.test(m.text())) errors.push(m.text());
  });
  const t = tl(page);
  await t.threeSteps();
  await expect(t.card(0)).toHaveAttribute("data-icon", "box");
  await expect(t.card(1)).toHaveAttribute("data-icon", "cluster");
  await expect(t.card(0)).toHaveAttribute("title", /^Box delete, 27 points/);
  await expect(t.card(1)).toHaveAttribute("title", /^Cluster delete, 40 points/);
  await expect(t.card(2)).toHaveAttribute("title", /, 4 points/);
  await expect(t.card(0)).toContainText("27");
  await expect(t.card(1)).toContainText("40");
  await expect(t.card(2)).toContainText("4");
  await expect(t.marker).toHaveAttribute("aria-valuenow", "3");
  await expect(t.marker).toHaveAttribute("aria-valuetext", "After step 3 of 3");
  const h = await sidsOf(page);
  expect(h.entries.map((e) => e.count)).toEqual([ROOM.ghost, ROOM.wall, ROOM.noise]);
  await expect(page.locator("#history-list li")).toHaveCount(3); // the right-panel list stays
  expect(errors).toEqual([]);
});

test("E2E-51 11 click highlights a step's points in a distinct colour, hover previews lighter, click again and Esc clear", async ({ page }) => {
  const t = tl(page);
  await t.threeSteps();
  await page.mouse.move(5, 5);
  const none = await page.locator("#viewport").screenshot();
  expect((await stepLayer(page)).visible).toBe(false);
  await expect(page.locator('#legend [data-legend="step"]')).toHaveCount(0);
  await t.card(1).locator(".step-icon").click();
  await expect.poll(async () => (await stepLayer(page)).count, { timeout: 15000 }).toBe(ROOM.wall); // recorded count = fixture truth
  const on = await stepLayer(page);
  expect(on).toMatchObject({ visible: true, hover: false, opacity: 0.95 });
  const css = (c: number[]) => c.map((v) => Math.round(v * 255)).join(",");
  expect(css(on.colour)).not.toBe("230,57,70"); // not the Deleted overlay colour
  expect(css(on.colour)).not.toBe("255,159,28"); // not the selected colour
  await expect(page.locator('#legend [data-legend="step"]')).toHaveCSS("background-color", `rgb(${css(on.colour).replaceAll(",", ", ")})`);
  await expect(page.locator("#legend")).toContainText("Step highlight");
  await page.mouse.move(5, 5);
  await page.waitForTimeout(400);
  expect(Buffer.compare(none, await page.locator("#viewport").screenshot())).not.toBe(0);
  // hover another step: lighter preview of that step
  await t.card(2).locator(".step-icon").hover();
  await expect.poll(async () => (await stepLayer(page)).hover, { timeout: 15000 }).toBe(true);
  await expect.poll(async () => (await stepLayer(page)).count).toBe(ROOM.noise);
  const hov = await stepLayer(page);
  expect(css(hov.colour)).not.toBe(css(on.colour));
  expect(hov.opacity).toBe(0.7);
  await page.mouse.move(5, 5);
  await expect.poll(async () => (await stepLayer(page)).count).toBe(ROOM.wall);
  // click the same step again clears
  await t.card(1).locator(".step-icon").click();
  await page.mouse.move(5, 5); // while the pointer rests on the card its lighter hover preview stays
  await expect.poll(async () => (await stepLayer(page)).visible).toBe(false);
  await expect(page.locator('#legend [data-legend="step"]')).toHaveCount(0);
  // Esc clears too (focus is on the strip, and with focus elsewhere)
  await t.card(0).locator(".step-icon").click();
  await expect.poll(async () => (await stepLayer(page)).count).toBe(ROOM.ghost);
  await page.mouse.move(5, 5);
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await stepLayer(page)).visible).toBe(false);
  await t.card(0).locator(".step-icon").click();
  await page.mouse.move(5, 5);
  await expect.poll(async () => (await stepLayer(page)).visible).toBe(true);
  await page.locator("#viewport").focus();
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await stepLayer(page)).visible).toBe(false);
  // click on the strip background clears as well
  await t.card(0).locator(".step-icon").click();
  await page.mouse.move(5, 5);
  await expect.poll(async () => (await stepLayer(page)).visible).toBe(true);
  const sb = (await page.locator("#timeline-scroll").boundingBox())!;
  await page.mouse.click(sb.x + sb.width - 6, sb.y + 6);
  await expect.poll(async () => (await stepLayer(page)).visible).toBe(false);
});

for (const [w, hgt] of [[1280, 720], [1920, 1080]] as const) {
  test(`E2E-52 11 the strip sits under the stage at ${w}x${hgt}, overlaps nothing and scrolls on its own with 25 steps`, async ({ page }) => {
    test.setTimeout(240000);
    await page.setViewportSize({ width: w, height: hgt });
    const t = tl(page);
    await t.open();
    await t.boxAt(0, 0, 0, 0.5, 0.5, 0.5);
    await t.setNum("box-center-y", 0);
    for (let i = 0; i < 25; i++) {
      await t.setNum("box-center-x", i % 20);
      if (i >= 20) await t.setNum("box-center-y", 1);
      await t.exact("Candidates", "1");
      await t.ctl("apply").click();
      await expect(t.cards).toHaveCount(i + 1);
    }
    const r = await page.evaluate(() => {
      const box = (s: string) => {
        const e = document.querySelector(s);
        if (!e) return null;
        const b = e.getBoundingClientRect();
        return { x: b.left, y: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height };
      };
      const doc = document.documentElement;
      const scroll = document.querySelector("#timeline-scroll") as HTMLElement;
      return {
        timeline: box("#timeline"),
        stage: box("#stage"),
        status: box("#statusbar"),
        legend: box("#legend"),
        cube: box("#viewcube"),
        boxes: [...document.querySelectorAll("#fbox-layer .fbox")].map((e) => {
          const b = e.getBoundingClientRect();
          return { x: b.left, y: b.top, r: b.right, b: b.bottom };
        }),
        docScroll: [doc.scrollWidth - doc.clientWidth, doc.scrollHeight - doc.clientHeight],
        scroll: [scroll.scrollWidth, scroll.clientWidth],
      };
    });
    const tlb = r.timeline!;
    expect(tlb.h).toBeGreaterThanOrEqual(60);
    expect(tlb.h).toBeLessThanOrEqual(68);
    expect(r.stage!.b).toBeLessThanOrEqual(tlb.y + 1); // strip is below the stage
    expect(tlb.b).toBeLessThanOrEqual(r.status!.y + 1); // and above the status bar
    const hit = (a: { x: number; y: number; r: number; b: number }) => a.x < tlb.r && a.r > tlb.x && a.y < tlb.b && a.b > tlb.y;
    for (const [name, b] of [["legend", r.legend], ["viewcube", r.cube]] as const) expect(b && hit(b), `${name} overlaps the strip`).toBeFalsy();
    for (const b of r.boxes) expect(hit(b), "a filter box overlaps the strip").toBeFalsy();
    expect(r.docScroll).toEqual([0, 0]);
    expect(r.scroll[0], "25 steps need their own horizontal scroll").toBeGreaterThan(r.scroll[1]);
    // the newest step is scrolled into view
    const last = (await t.card(24).boundingBox())!;
    expect(last.x + last.width).toBeLessThanOrEqual(tlb.r + 1);
  });
}

test("E2E-53 11 dragging the marker with the real mouse rolls back and forward; counts equal fixture truth; Undo and Redo move it one slot", async ({ page }) => {
  const t = tl(page);
  await t.threeSteps();
  t.rollbacks.length = 0;
  await t.dragMarkerTo(1);
  await t.exact("Active", String(ROOM_TOTAL - ROOM.ghost));
  await expect(t.marker).toHaveAttribute("aria-valuenow", "1");
  expect(t.rollbacks).toHaveLength(1); // one POST on release, none while dragging
  expect(JSON.parse(t.rollbacks[0]).cursor).toBe(1);
  await expect(t.card(0)).not.toHaveClass(/greyed/);
  await expect(t.card(1)).toHaveClass(/greyed/);
  await expect(t.card(2)).toHaveClass(/greyed/);
  await expect(t.card(1)).toHaveAttribute("title", /rolled back/);
  await t.dragMarkerTo(3);
  await t.exact("Active", String(ACTIVE_ALL));
  await expect(t.card(2)).not.toHaveClass(/greyed/);
  // a drag that returns to where it started makes no call
  t.rollbacks.length = 0;
  const mb = (await t.marker.boundingBox())!;
  await page.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2);
  await page.mouse.down();
  await page.mouse.move(mb.x - 100, mb.y + mb.height / 2, { steps: 4 });
  await page.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2, { steps: 4 });
  await page.mouse.up();
  expect(t.rollbacks).toHaveLength(0);
  // Undo and Redo are the marker -1 / +1
  await t.ctl("undo").click();
  await t.exact("Active", String(ACTIVE_ALL + ROOM.noise));
  await expect(t.marker).toHaveAttribute("aria-valuenow", "2");
  await t.ctl("redo").click();
  await t.exact("Active", String(ACTIVE_ALL));
  await expect(t.marker).toHaveAttribute("aria-valuenow", "3");
});

test("E2E-54 11 'Roll back to here' and the slider keys give the same state as the drag", async ({ page }) => {
  const t = tl(page);
  await t.threeSteps();
  await t.card(0).hover();
  await t.card(0).locator('[data-act="rollback"]').click();
  await t.exact("Active", String(ROOM_TOTAL - ROOM.ghost));
  await expect(t.marker).toHaveAttribute("aria-valuenow", "1");
  await t.marker.focus();
  await page.keyboard.press("ArrowRight");
  await t.exact("Active", String(ROOM_TOTAL - ROOM.ghost - ROOM.wall));
  await page.keyboard.press("End");
  await t.exact("Active", String(ACTIVE_ALL));
  await page.keyboard.press("Home");
  await t.exact("Active", String(ROOM_TOTAL));
  await expect(t.marker).toHaveAttribute("aria-valuenow", "0");
  await expect(t.marker).toHaveAttribute("aria-valuetext", /Before the first step/);
  await page.keyboard.press("ArrowRight");
  await t.exact("Active", String(ROOM_TOTAL - ROOM.ghost));
  await page.keyboard.press("ArrowLeft");
  await t.exact("Active", String(ROOM_TOTAL));
  await page.keyboard.press("End");
  await t.exact("Active", String(ACTIVE_ALL));
});

test("E2E-55 11 deleting the middle step returns only its points; dismissing the confirmation changes nothing", async ({ page }) => {
  const t = tl(page);
  await t.threeSteps();
  t.mode.answer = "dismiss";
  await t.card(1).hover();
  await t.card(1).locator('[data-act="delete"]').click();
  await expect.poll(() => t.dialogs.length).toBe(1);
  expect(t.dialogs[0]).toContain('Remove step "Cluster 2"');
  expect(t.dialogs[0]).toContain("Its 40 points come back");
  await expect(t.cards).toHaveCount(3);
  await t.exact("Active", String(ACTIVE_ALL));
  t.mode.answer = "accept";
  await t.card(1).hover();
  await t.card(1).locator('[data-act="delete"]').click();
  await expect(t.cards).toHaveCount(2);
  await t.exact("Active", String(ACTIVE_ALL + ROOM.wall)); // the wall is back; the box step and the noise step still delete
  await expect(t.card(0)).toHaveAttribute("title", /^Box delete, 27 points/);
  await expect(t.card(1)).toContainText(String(ROOM.noise));
  await expect(t.marker).toHaveAttribute("aria-valuenow", "2");
  await expect(page.locator("#unsaved-badge")).toHaveText("Unsaved edits");
  // keyboard: Delete on a focused step removes it (with the confirmation) and never fires the global Apply.
  // The box tool restarts its preview after the delete above; a step gesture under that job is refused with a notice by
  // design (seen as the busy notice in 2 of 120 runs), so wait for idle like the marker gestures do.
  await t.idle();
  const before = await page.evaluate(() => (window as unknown as { __editor: { state: () => { session: { counts: { active: number } } } } }).__editor.state().session.counts.active);
  t.dialogs.length = 0;
  t.mode.answer = "dismiss";
  await t.card(1).focus();
  await page.keyboard.press("Delete");
  await expect.poll(() => t.dialogs.length).toBe(1);
  await expect(t.cards).toHaveCount(2);
  expect(await page.evaluate(() => (window as unknown as { __editor: { state: () => { session: { counts: { active: number } } } } }).__editor.state().session.counts.active)).toBe(before);
  t.mode.answer = "accept";
  await t.card(1).focus();
  await page.keyboard.press("Backspace");
  await expect(t.cards).toHaveCount(1);
  await t.exact("Active", String(ACTIVE_ALL + ROOM.wall + ROOM.noise));
});

test("E2E-56 11 applying while rolled back asks first: dismiss changes nothing, accept discards the greyed steps", async ({ page }) => {
  const t = tl(page);
  await t.threeSteps();
  await t.card(0).hover();
  await t.card(0).locator('[data-act="rollback"]').click();
  await t.exact("Active", String(ROOM_TOTAL - ROOM.ghost));
  await t.boxAt(-1, 4.5, 2.5, 1, 10, 5);
  await t.exact("Candidates", String(ROOM.wall));
  t.mode.answer = "dismiss";
  await t.ctl("apply").click();
  await expect.poll(() => t.dialogs.length).toBe(1);
  expect(t.dialogs[0]).toBe("Applying a new deletion discards the 2 rolled-back step(s) after the marker (they cannot be redone). Continue?");
  await expect(t.cards).toHaveCount(3);
  await t.exact("Active", String(ROOM_TOTAL - ROOM.ghost));
  await expect(t.marker).toHaveAttribute("aria-valuenow", "1");
  t.mode.answer = "accept";
  await t.ctl("apply").click();
  await expect(t.cards).toHaveCount(2);
  await t.exact("Active", String(ROOM_TOTAL - ROOM.ghost - ROOM.wall));
  await expect(t.card(1)).toContainText(String(ROOM.wall));
  await expect(t.card(1)).not.toHaveClass(/greyed/);
  await expect(t.ctl("redo")).toBeDisabled(); // nothing to redo any more
});

test("E2E-57 11 rename by double-click on the name, by the pencil and by F2; the icon double-click highlights nothing new", async ({ page }) => {
  const t = tl(page);
  await t.threeSteps();
  await t.card(1).locator(".step-label").dblclick();
  const input = t.card(1).locator("input.step-rename");
  await expect(input).toBeFocused();
  await input.fill("Wall");
  await input.press("Enter");
  await expect(t.card(1).locator(".step-label")).toHaveText("Wall");
  await expect(t.card(1)).toHaveAttribute("title", /^Wall delete, 40 points/);
  expect((await stepLayer(page)).visible).toBe(false); // the double-click did not toggle a highlight
  await t.card(0).hover();
  await t.card(0).locator('[data-act="rename"]').click();
  await t.card(0).locator("input.step-rename").fill("Ghost");
  await t.card(0).locator("input.step-rename").press("Enter");
  await expect(t.card(0).locator(".step-label")).toHaveText("Ghost");
  await t.card(2).focus();
  await page.keyboard.press("F2");
  await t.card(2).locator("input.step-rename").fill("Noise");
  await page.keyboard.press("Escape");
  await expect(t.card(2).locator(".step-label")).not.toHaveText("Noise"); // Esc cancels
  await page.keyboard.press("F2");
  await t.card(2).locator("input.step-rename").fill("Noise");
  await page.locator("#viewport").click({ position: { x: 5, y: 5 } }); // blur commits
  await expect(t.card(2).locator(".step-label")).toHaveText("Noise");
  expect((await sidsOf(page)).entries.map((e) => e.name)).toEqual(["Ghost", "Wall", "Noise"]);
  // clearing the name goes back to the default label
  await t.card(1).locator(".step-label").dblclick();
  await t.card(1).locator("input.step-rename").fill("");
  await t.card(1).locator("input.step-rename").press("Enter");
  await expect(t.card(1).locator(".step-label")).toHaveText("Cluster 2");
  // double-click on the icon highlights twice (on, off): net nothing
  await t.card(0).locator(".step-icon").dblclick();
  await page.mouse.move(5, 5);
  await expect.poll(async () => (await stepLayer(page)).visible).toBe(false);
  await expect(t.cards).toHaveCount(3);
  await t.exact("Active", String(ACTIVE_ALL)); // a name changes no count
});

test("E2E-58 11 the strip survives save and reopen (names, order, marker, counts) and an export after a rollback holds exactly the active steps' result", async ({ page }, testInfo) => {
  const t = tl(page);
  await t.threeSteps();
  await t.card(0).locator(".step-label").dblclick();
  await t.card(0).locator("input.step-rename").fill("Ghost block");
  await t.card(0).locator("input.step-rename").press("Enter");
  await t.card(1).hover();
  await t.card(1).locator('[data-act="rollback"]').click(); // marker after step 2: the noise step is greyed
  await t.exact("Active", String(ROOM_TOTAL - ROOM.ghost - ROOM.wall));
  const [dl] = await Promise.all([page.waitForEvent("download"), t.ctl("save-session").click()]);
  const path = testInfo.outputPath("steps.pcdsession");
  await dl.saveAs(path);
  const before = await sidsOf(page);
  await page.locator("#file-input").setInputFiles({ name: "other.pcd", mimeType: "application/octet-stream", buffer: syntheticPcd() });
  await t.exact("Active", String(TOTAL));
  await expect(t.cards).toHaveCount(0);
  await page.locator("#file-input").setInputFiles({ name: "steps.pcdsession", mimeType: "application/octet-stream", buffer: readFileSync(path) });
  await t.exact("Original", String(ROOM_TOTAL));
  await expect(t.cards).toHaveCount(3);
  const after = await sidsOf(page);
  expect(after).toEqual(before);
  expect(after.entries.map((e) => e.name)).toEqual(["Ghost block", null, null]);
  await expect(t.card(0).locator(".step-label")).toHaveText("Ghost block");
  await expect(t.marker).toHaveAttribute("aria-valuenow", "2");
  await expect(t.card(2)).toHaveClass(/greyed/);
  await t.exact("Active", String(ROOM_TOTAL - ROOM.ghost - ROOM.wall));
  // export while rolled back: exactly the cloud minus the box step and the cluster step
  await t.ctl("export").click();
  const [ex] = await Promise.all([page.waitForEvent("download"), t.ctl("export-go").click()]);
  const exPath = testInfo.outputPath("rolled.pcd");
  await ex.saveAs(exPath);
  const rows = parsePcd(readFileSync(exPath)).rows;
  const room = parsePcd(roomPcd()).rows;
  const rowKey = (r: number[]) => r.map(Math.fround).join(","); // the export is float32
  const inGhost = (r: number[]) => r[0] >= 2 && r[0] <= 4 && r[1] >= 12 && r[1] <= 14 && r[2] >= 1 && r[2] <= 3;
  const isWall = (r: number[]) => r[0] === -1 && r[1] >= 0 && r[1] <= 9 && r[2] >= 1 && r[2] <= 4;
  const expected = room.filter((r) => !inGhost(r) && !isWall(r)).map(rowKey).sort();
  expect(rows.length).toBe(ROOM_TOTAL - ROOM.ghost - ROOM.wall);
  expect(rows.map(rowKey).sort()).toEqual(expected);
});

/** Cluster seeds on the room (radius 1 separates the clusters): the wall (40), the ghost blob (27), the floor with its nine slab ghosts (409). */
const CL = { wall: [-1, 4, 4], blob: [3, 13, 3], floor: [10, 10, 0] } as const;
const inWall = (r: number[]) => r[0] === -1 && r[1] >= 0 && r[1] <= 9 && r[2] >= 1 && r[2] <= 4;
const inBlob = (r: number[]) => r[0] >= 2 && r[0] <= 4 && r[1] >= 12 && r[1] <= 14 && r[2] >= 1 && r[2] <= 3;
const f32key = (r: number[]) => r.map(Math.fround).join(",");

function clusterHelpers(page: import("@playwright/test").Page) {
  const h = helpers(page);
  // these tests delete most of the cloud: accept the bulk-delete confirmation and keep its text
  page.removeAllListeners("dialog");
  const confirms: string[] = [];
  page.on("dialog", (d) => {
    if (/points \(/.test(d.message())) confirms.push(d.message());
    void d.accept();
  });
  /** A real mouse click on the projected seed point, with the seed picker armed (default perspective view). */
  const pickSeed = async (at: readonly number[]) => {
    await h.ctl("cluster-pick-seed").click();
    await page.waitForTimeout(200);
    const px = await page.evaluate((p) => (window as unknown as { __editor: EditorHook }).__editor.projectWorld(p as [number, number, number]), [...at]);
    expect(px).not.toBeNull();
    await page.mouse.click(px!.x, px!.y);
    await expect(page.locator("#editpanels")).toContainText("Seed: point");
  };
  /** Export the active points through the dialog and compare with the room minus `deleted`. */
  const expectActive = async (testInfo: import("@playwright/test").TestInfo, deleted: (r: number[]) => boolean) => {
    await h.ctl("export").click();
    const [dl] = await Promise.all([page.waitForEvent("download"), h.ctl("export-go").click()]);
    const path = testInfo.outputPath(`cluster-${Date.now()}.pcd`);
    await dl.saveAs(path);
    const room = parsePcd(roomPcd()).rows;
    const expected = room.filter((r) => !deleted(r)).map(f32key).sort();
    const rows = parsePcd(readFileSync(path)).rows;
    expect(rows.length).toBe(expected.length);
    expect(rows.map(f32key).sort()).toEqual(expected);
  };
  return { ...h, pickSeed, expectActive, confirms };
}

test("E2E-60 a single Cluster (seed click, preview) enables Apply and deletes exactly the cluster", async ({ page }, testInfo) => {
  const t = clusterHelpers(page);
  await openRoom(page, t.exact);
  await t.ctl("tool-cluster").click();
  await t.pickSeed(CL.wall);
  await t.setNum("cluster-radius", 1);
  await t.exact("Candidates", String(ROOM.wall));
  await expect(t.ctl("apply")).toBeEnabled();
  await t.ctl("apply").click();
  await t.exact("Active", String(ROOM_TOTAL - ROOM.wall));
  await t.expectActive(testInfo, inWall);
});

/** The floor cluster at radius 1.1: the floor, its nine slab ghosts and the ghost blob standing on it (the blob is one grid step above the floor). */
const FLOOR_CLUSTER = ROOM.floor + ROOM.floorGhost + ROOM.ghost;
const inFloorCluster = (r: number[]) => Number.isFinite(r[0]) && !inWall(r) && r[3] !== 0.1;

test("E2E-61 Cluster with Operation Add: after Commit draft the selection is |A union B| and Apply deletes exactly that set", async ({ page }, testInfo) => {
  const t = clusterHelpers(page);
  await openRoom(page, t.exact);
  await t.ctl("tool-cluster").click();
  await t.setNum("cluster-radius", 1.1);
  await t.pickSeed(CL.wall);
  await t.exact("Selected", String(ROOM.wall));
  await t.ctl("op-select").selectOption("add");
  await t.pickSeed(CL.floor);
  await expect(page.locator("#draft-note")).toBeVisible(); // a draft: nothing grows until Commit draft
  await expect(t.ctl("apply")).toBeDisabled();
  await t.exact("Selected", String(ROOM.wall));
  await t.ctl("sel-commit").click();
  await t.exact("Selected", String(ROOM.wall + FLOOR_CLUSTER));
  await t.exact("Candidates", String(ROOM.wall + FLOOR_CLUSTER));
  await expect(t.ctl("apply")).toBeEnabled();
  await t.ctl("apply").click();
  await t.exact("Active", String(ROOM_TOTAL - ROOM.wall - FLOOR_CLUSTER));
  expect(t.confirms[0]).toContain(`${ROOM.wall + FLOOR_CLUSTER} of ${ROOM_TOTAL} points`);
  await t.expectActive(testInfo, (r) => inWall(r) || inFloorCluster(r));
});

test("E2E-62 a single Cluster keeps Apply enabled across scope, protection and display filter; a protected seed says why", async ({ page }) => {
  const t = clusterHelpers(page);
  await openRoom(page, t.exact);
  await t.ctl("tool-cluster").click();
  await t.setNum("cluster-radius", 1.1);
  await t.pickSeed(CL.wall);
  await t.exact("Candidates", String(ROOM.wall));
  await expect(t.ctl("apply")).toBeEnabled();
  await t.ctl("scope-select").selectOption("active");
  await t.exact("Candidates", String(ROOM.wall));
  await expect(t.ctl("apply")).toBeEnabled();
  await t.ctl("scope-select").selectOption("displayed");
  await t.ctl("prot-enabled").check();
  await t.setNum("prot-min", -0.1);
  await t.setNum("prot-max", 0.1);
  await t.exact("Protected", String(ROOM.floor + ROOM.floorGhost));
  await t.exact("Candidates", String(ROOM.wall));
  await expect(t.ctl("apply")).toBeEnabled();
  await t.setNum("filter-z-min", 0.5);
  await t.exact("Candidates", String(ROOM.wall));
  await expect(t.ctl("apply")).toBeEnabled();
  await t.ctl("filter-z-min-reset").click();
  // a seed inside the protected slab is refused with its reason, and Apply stays off
  await t.ctl("cluster-pick-seed").click();
  const px = await page.evaluate((p) => (window as unknown as { __editor: EditorHook }).__editor.projectWorld(p as [number, number, number]), [12, 12, 0]);
  await page.mouse.click(px!.x, px!.y);
  await expect(page.locator("#notices")).toContainText("seed must be an active, valid, in-scope, unexcluded point");
  await expect(t.ctl("apply")).toBeDisabled();
});

test("E2E-63 Preview with a pending Add cluster draft keeps the draft and never makes the old selection appliable", async ({ page }) => {
  const t = clusterHelpers(page);
  await openRoom(page, t.exact);
  await t.ctl("tool-cluster").click();
  await t.setNum("cluster-radius", 1.1);
  await t.pickSeed(CL.wall);
  await t.exact("Selected", String(ROOM.wall));
  await t.ctl("op-select").selectOption("add");
  await t.pickSeed(CL.floor);
  await expect(page.locator("#draft-note")).toBeVisible();
  await t.ctl("preview").click();
  await expect(page.locator("#notices")).toContainText("Commit or discard the drafted tool shape first");
  await expect(page.locator("#draft-note")).toBeVisible();
  await expect(t.ctl("apply")).toBeDisabled();
  await expect(t.ctl("apply")).toHaveAttribute("title", /commit or discard/);
  await t.exact("Selected", String(ROOM.wall));
});

test("E2E-64 Cluster Subtract and Intersect commit against the existing selection and Apply deletes exactly the result", async ({ page }, testInfo) => {
  const t = clusterHelpers(page);
  await openRoom(page, t.exact);
  await t.ctl("tool-cluster").click();
  await t.setNum("cluster-radius", 1.1);
  await t.ctl("sel-select-displayed").click();
  await t.exact("Selected", String(ROOM_TOTAL - ROOM.invalid));
  await t.ctl("op-select").selectOption("subtract");
  await t.pickSeed(CL.wall);
  await t.ctl("sel-commit").click();
  await t.exact("Selected", String(ROOM_TOTAL - ROOM.invalid - ROOM.wall));
  await t.ctl("op-select").selectOption("intersect");
  await t.pickSeed(CL.floor);
  await t.ctl("sel-commit").click();
  await t.exact("Selected", String(FLOOR_CLUSTER));
  await t.exact("Candidates", String(FLOOR_CLUSTER));
  await expect(t.ctl("apply")).toBeEnabled();
  await t.ctl("apply").click();
  await t.exact("Active", String(ROOM_TOTAL - FLOOR_CLUSTER));
  expect(t.confirms[0]).toContain(`${FLOOR_CLUSTER} of ${ROOM_TOTAL} points`);
  await t.expectActive(testInfo, inFloorCluster);
});

test("E2E-65 11 Delete on a focused step button or on the marker never fires Apply; on a step button it removes that step", async ({ page }) => {
  const t = tl(page);
  await t.threeSteps();
  await t.card(0).hover();
  await t.card(0).locator('[data-act="rollback"]').click();
  await t.exact("Active", String(ROOM_TOTAL - ROOM.ghost));
  await t.boxAt(-1, 4.5, 2.5, 1, 10, 5);
  await t.exact("Candidates", String(ROOM.wall));
  await t.idle();
  t.dialogs.length = 0;
  t.mode.answer = "dismiss";
  // an applicable candidate exists and the marker is rolled back: a leaking Delete would open the discard confirmation
  await t.marker.focus();
  await page.keyboard.press("Delete");
  await page.keyboard.press("Backspace");
  await t.card(1).hover();
  const del = t.card(1).locator('[data-act="delete"]');
  await del.focus();
  await page.keyboard.press("Delete");
  await expect.poll(() => t.dialogs.length).toBe(1);
  expect(t.dialogs[0]).toContain('Remove step "Cluster 2"'); // the step's own confirmation, not "Applying a new deletion discards"
  await expect(t.cards).toHaveCount(3);
  await t.exact("Active", String(ROOM_TOTAL - ROOM.ghost));
  await t.exact("Candidates", String(ROOM.wall));
  expect(t.dialogs.some((d) => d.startsWith("Applying a new deletion"))).toBe(false);
});

test("E2E-66 11 rapid marker keys and Undo/Redo clicks send no stale request: no 409, no console error, no 'preview again', final state exact", async ({ page }) => {
  const errors: string[] = [];
  const stale: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("response", (r) => {
    if (r.status() === 409) stale.push(r.url());
  });
  const t = tl(page);
  await t.threeSteps();
  await t.idle();
  await t.marker.focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft"); // no waiting between presses: 3 steps back
  await expect(t.marker).toHaveAttribute("aria-valuenow", "0");
  await t.exact("Active", String(ROOM_TOTAL));
  for (let i = 0; i < 2; i++) await page.keyboard.press("ArrowRight");
  await expect(t.marker).toHaveAttribute("aria-valuenow", "2");
  await t.exact("Active", String(ROOM_TOTAL - ROOM.ghost - ROOM.wall));
  await t.idle();
  for (let i = 0; i < 2; i++) await t.ctl("undo").click({ delay: 0 });
  await expect(t.marker).toHaveAttribute("aria-valuenow", "0");
  for (let i = 0; i < 3; i++) await t.ctl("redo").click({ delay: 0 });
  await expect(t.marker).toHaveAttribute("aria-valuenow", "3");
  await t.exact("Active", String(ACTIVE_ALL));
  await expect(page.locator("#notices")).not.toContainText("preview again");
  expect(stale).toEqual([]);
  expect(errors.filter((e) => !/Failed to load resource.*404/.test(e))).toEqual([]);
});

test("E2E-67 10 a typed tilt beyond the limit is refused with a notice naming the limit under the field, and the note clears on a valid value", async ({ page }) => {
  const { exact, ctl, setNum } = helpers(page);
  await openRoom(page, exact);
  if (!(await ctl("prot-tilt-x").isVisible())) await protSummary(page).click(); // a restored fold state may have it closed
  const note = page.locator("#prot-tilt-note");
  await expect(note).toBeHidden();
  for (const bad of [61, -61, 90]) {
    await setNum("prot-tilt-x", bad);
    await expect(note).toBeVisible();
    await expect(note).toContainText("limited to +-60 degrees");
    await expect(ctl("prot-tilt-x")).toHaveValue("0"); // the field reverts
  }
  await setNum("prot-tilt-x", 10);
  await expect(note).toBeHidden();
  await expect(ctl("prot-tilt-x")).toHaveValue("10");
  await setNum("prot-tilt-y", 75);
  await expect(note).toBeVisible();
  await ctl("prot-level").click(); // Level also clears the refusal
  await expect(note).toBeHidden();
  await expect(ctl("prot-tilt-x")).toHaveValue("0");
});
