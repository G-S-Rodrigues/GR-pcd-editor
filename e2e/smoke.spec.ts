import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { BIG, FLOOR, GHOST, NORMAL_ROOM_TOTAL, ROOM, ROOM_TOTAL, SPARSE, SPARSE_TOTAL, TILTED, TOTAL, bigRoomPcd, bigRoomXyz, countInTiltedSlab, clusterNearestTruth, countInXyz, normalRoomPcd, parsePcd, roomPcd, rowKey, sparseRoomPcd, syntheticPcd, tiltedFloorAngles, tiltedFloorPcd, truthKeys } from "./synthetic";

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

  await test.step("E2E-02 pivot: reset, pick", async () => {
    await page.locator('[data-control="pivot-reset"]').click();
    await expect(page.locator("#inspector")).toContainText("4.5, 4.5, 1.5");
    // the typed fields and Set pivot are gone; the pivot is set by picking. Top view: the point under the click with the greatest Z is picked
    await expect(page.locator('[data-control="pivot-x"]')).toHaveCount(0);
    await expect(page.locator('[data-control="pivot-set"]')).toHaveCount(0);
    await page.locator('[data-control="pivot-pick"]').click();
    await expect(page.locator("#modebar")).toContainText("Tool: Pick pivot");
    await expect(page.locator('[data-control="pivot-pick"]')).toHaveAttribute("aria-pressed", "true");
    await pickAtWorld(page, [4, 4, 0]);
    await expect(page.locator("#inspector")).toContainText("Pivot4, 4, 3");
    await expect(page.locator("#modebar")).toContainText("Tool: None");
  });

  await test.step("E2E-01 colouring options follow the schema", async () => {
    const colour = page.locator('[data-control="colour-mode"]');
    expect(await colour.locator("option").evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value))).toEqual(["turbo", "viridis", "flat", "distance", "normals"]);
    await expect(colour).toHaveValue("turbo");
    await colour.selectOption("viridis");
    await expect(colour).toHaveValue("viridis");
    await expect(page.locator("#legend-ramp")).toHaveAttribute("data-ramp", "viridis");
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

/** Filter boxes open collapsed (17): expand the box behind a `filter-<axis>-<side>[-grip|-reset|-toggle]` control before touching it. */
async function expandFilterBox(page: import("@playwright/test").Page, id: string): Promise<void> {
  const m = /^filter-([xyz]-(?:min|max))(?:-grip|-reset|-toggle)?$/.exec(id);
  if (!m) return;
  const tog = page.locator(`[data-control="filter-${m[1]}-toggle"]`);
  if ((await tog.getAttribute("aria-expanded")) === "false") await tog.click();
}

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
    await expandFilterBox(page, id);
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
    await expandFilterBox(page, id);
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
    await expect(page.locator("#inspector")).toContainText("retained by protection");
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

  await test.step("E2E-07 comparison: overlay and split keep the exact counts", async () => {
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
    await exact("Active", String(activeBefore - GHOST));
    await ctl("tool-box").click(); // leave the tool
  });

  await test.step("AC-17 view state: colouring is stored with the session", async () => {
    const put = page.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith("/api/session/client-state") && JSON.parse(r.postData() ?? "{}")?.colour === "viridis");
    await ctl("colour-mode").selectOption("viridis");
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
    await expect(ctl("colour-mode")).toHaveValue("viridis"); // restored from the archive's client state
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
    await expandFilterBox(page, id);
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

test("E2E-11 7a the Box tool opens as a 3 m cube and a bulk delete asks for confirmation (F-03)", async ({ page }) => {
  const { stat, exact, num, ctl, boxEverything, dialogs } = helpers(page);
  await page.goto("/");
  await page.locator("#file-input").setInputFiles({ name: "synthetic.pcd", mimeType: "application/octet-stream", buffer: syntheticPcd() });
  await exact("Displayed", String(FLOOR + GHOST));
  const activeBefore = await num("Active");
  await ctl("tool-box").click();
  await expect.poll(async () => (await stat("Candidates").innerText()).includes("—"), { timeout: 15000 }).toBe(false);
  // the default box is 3 m on each side (owner ruling, part 13); its candidates are exactly the points inside it, fewer than the cloud
  const size = [await ctl("box-size-x").inputValue(), await ctl("box-size-y").inputValue(), await ctl("box-size-z").inputValue()].map(Number);
  expect(size).toEqual([3, 3, 3]);
  const centre = [await ctl("box-center-x").inputValue(), await ctl("box-center-y").inputValue(), await ctl("box-center-z").inputValue()].map(Number);
  const xyz = Float32Array.from(parsePcd(syntheticPcd()).rows.flatMap((r) => [r[0], r[1], r[2]]));
  const inside = countInXyz(xyz, centre, size);
  expect(inside).toBeGreaterThan(0);
  expect(inside).toBeLessThan(FLOOR + GHOST);
  await exact("Candidates", String(inside));
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
  await pickPivotAt(page, [4, 4, 0]);
  await ctl("tool-cluster").click(); // arming Cluster waits for the seed click
  await page.locator("#viewport").click(); // top view: the point under the pivot with the greatest Z, a ghost point
  await expect(page.locator("#inspector")).toContainText("Seed: point");
  await setNum("cluster-radius", 1.2); // links the ghost blob to the floor below it

  await ctl("cluster-max-points").fill("5");
  await ctl("cluster-max-points").press("Tab");
  await expect(page.locator("#inspector")).toContainText("Stopped at limit 5", { timeout: 15000 });
  await exact("Candidates", "5"); // the cap is exact
  await expect(ctl("apply")).toBeEnabled(); // a partial cluster can be deleted (R17-1)

  await ctl("cluster-max-points").fill("");
  await ctl("cluster-max-points").press("Tab");
  await exact("Candidates", String(FLOOR + GHOST));
  await expect(page.locator("#inspector")).not.toContainText("Stopped at");
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
  state: () => { camera: { target: number[]; orientation: number[]; distance: number; ortho: boolean }; tools: { box: { center: number[]; dimensions: number[]; quat: number[] }; protection: { global: { enabled: boolean; min: number; max: number } } } };
  projectWorld: (p: number[]) => { x: number; y: number } | null;
  handlePositions: () => { id: string; x: number; y: number }[];
  boxBodyPoint: () => { x: number; y: number } | null;
  boxRings: () => { id: string; centreWorld: number[]; centre: { x: number; y: number } | null; pts: { x: number; y: number }[] }[];
  drawnCount: () => number;
  previewLayer: () => { id: string | null; add: number; remove: number };
};
const hook = <T>(page: import("@playwright/test").Page, fn: (e: EditorHook) => T) =>
  page.evaluate(`(${fn.toString()})(window.__editor)`) as Promise<T>;
/** Waits for a projected world point to stop moving (the view animates to a preset), then returns it. */
async function settledScreen(page: import("@playwright/test").Page, world: number[]): Promise<{ x: number; y: number }> {
  const read = () => page.evaluate((w) => (window as unknown as { __editor: EditorHook }).__editor.projectWorld(w), world);
  let prev: { x: number; y: number } | null = null;
  await expect
    .poll(async () => {
      const now = await read();
      const still = !!prev && !!now && Math.hypot(now.x - prev.x, now.y - prev.y) < 0.5;
      prev = now;
      return still;
    }, { timeout: 5000, intervals: [100] })
    .toBe(true);
  return prev!;
}
/** With Pick pivot already armed: a real click on the screen position of a world point. */
async function pickAtWorld(page: import("@playwright/test").Page, world: number[]): Promise<void> {
  const at = await settledScreen(page, world);
  await page.mouse.click(at.x, at.y);
}
/** Arms Pick pivot, clicks the screen position of a world point (the point drawn there becomes the pivot) and waits for orbit again (the active tool is left as it is). */
async function pickPivotAt(page: import("@playwright/test").Page, world: number[]): Promise<void> {
  await page.locator('[data-control="pivot-pick"]').click();
  await expect(page.locator("#modebar")).toContainText("Tool: Pick pivot");
  await pickAtWorld(page, world);
  await expect(page.locator('[data-control="pivot-pick"]')).toHaveAttribute("aria-pressed", "false"); // the pick returned to orbit
}

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
  await realDrag(page, { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 }, { x: stage.x + stage.width / 2 + 120, y: stage.y + stage.height / 2 + 40 });
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
  for (const k of ["1", "P", "F", "Alt+F", "R (hold)", "Enter", "Esc", "Delete", "Ctrl+Z", "Ctrl+Y", "?"]) {
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
  await expandFilterBox(page, "filter-z-max");
  await ctl("filter-z-max").click(); // a number field: typing a ? in it must not open the help
  await page.keyboard.type("?");
  await expect(help).not.toBeVisible();
});

const OVERFLOW_SELECTORS = ["#toolbar", "#viewbar", "#tools", "#inspector", "#toolpanels", "#fileinfo", "#editpanels", "#statusbar", "#modebar"];

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
    await expandFilterBox(page, "filter-z-max");
    await page.locator('[data-control="filter-z-max"]').focus();
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

test("E2E-23 7b2 an Add shape is shown as a draft with its own outline colour and the server's previewed count, until committed", async ({ page }) => {
  const { exact, ctl, setNum } = helpers(page);
  await openRoom(page, exact);
  await ctl("tool-box").click();
  // owner ruling D: an Add over an EMPTY selection goes live, so first commit a selection with Replace
  for (const [id, v] of [["box-center-x", -1], ["box-center-y", 4.5], ["box-center-z", 2.5], ["box-size-x", 1], ["box-size-y", 10], ["box-size-z", 5]] as const) await setNum(id, v);
  await exact("Selected", String(ROOM.wall));
  await expect(ctl("apply")).toBeEnabled(); // wait for the live selection's candidate: an edit made between the selection's state and its candidate supersedes the candidate job
  await expect(page.locator("#draft-note")).toBeHidden();
  await ctl("op-add").click();
  await expect(page.locator("#draft-note")).toBeHidden();
  await ctl("box-size-x").fill("4");
  await ctl("box-size-x").press("Enter");
  await expect(page.locator("#draft-note")).toBeVisible();
  await expect(page.locator("#draft-note")).toContainText("Preview, not applied"); // 12b: the draft now shows its previewed result (was "Draft, not yet applied ... count is unknown")
  await expect(page.locator("#draft-note")).toContainText("Apply uses only those");
  await expect(ctl("sel-commit")).toBeEnabled();
  await expect(ctl("apply")).toBeEnabled(); // owner ruling A: Apply stays enabled during a draft (it deletes the committed selection only)
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

test("E2E-24 7b2 first page shows the start banner; a reloaded session starts Add, Displayed, no tool, default cluster limit", async ({ page }) => {
  const { exact, ctl } = helpers(page);
  // a previous test's session is still on the server: close it by opening a page without one is not possible, so check the banner by state
  await openRoom(page, exact);
  await expect(page.locator("#start-banner")).toBeHidden();
  await ctl("tool-cluster").click();
  await ctl("op-subtract").click();
  await ctl("scope-select").selectOption("active");
  await ctl("cluster-max-points").fill("1234");
  await ctl("cluster-max-points").press("Enter");
  await expect(page.locator("#modebar")).toContainText("Op: Subtract");
  await page.waitForTimeout(1600); // the client state is saved one second after the last change
  await page.reload();
  await exact("Original", String(ROOM_TOTAL));
  await expect(page.locator("#modebar")).toContainText("Tool: None");
  await expect(page.locator("#modebar")).toContainText("Op: Add");
  await expect(page.locator("#modebar")).toContainText("Scope: Displayed");
  await ctl("tool-cluster").click();
  await expect(ctl("cluster-max-points")).toHaveValue(/^500$/);
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
  await pickPivotAt(page, [22, 22, 0]);
  await ctl("tool-cluster").click(); // arming Cluster waits for the seed click
  await ctl("cluster-max-points").fill(""); // 17: the default limit is 500 and this 80,000-point component must be complete (empty means no limit)
  await ctl("cluster-max-points").press("Tab");
  await page.locator("#viewport").click(); // top view: the greatest Z under the pivot is a ghost point
  await expect(page.locator("#inspector")).toContainText("Seed: point");
  await setNum("cluster-radius", 2);
  await exact("Candidates", "80,000");
  await expect(page.locator("#inspector")).not.toContainText("Stopped at");
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
  await expandFilterBox(page, "filter-z-max");
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

test("E2E-156 17 the six filter boxes open collapsed as chips with no plane drawn; expanding one survives a reload and leaves the others collapsed", async ({ page }) => {
  const { exact, ctl } = helpers(page);
  await openRoom(page, exact);
  const fboxes = page.locator(".fbox");
  await expect(fboxes).toHaveCount(6);
  for (const b of await fboxes.all()) {
    await expect(b).toHaveClass(/collapsed/);
    await expect(b.locator(".ftog")).toHaveText(/^[XYZ](>=|<=) /);
  }
  await expect(ctl("filter-x-min")).toBeHidden();
  expect((await planesNow(page)).map((q) => q.key)).toEqual([]);
  const saved = page.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith("/api/session/client-state") && JSON.parse(r.postData() ?? "{}")?.ui?.boxesCollapsed?.["x-min"] === false);
  await ctl("filter-x-min-toggle").click();
  await expect(ctl("filter-x-min")).toBeVisible();
  await saved;
  await page.reload();
  await exact("Original", String(ROOM_TOTAL));
  await expect(ctl("filter-x-min")).toBeVisible();
  for (const key of ["x-max", "y-min", "y-max", "z-min", "z-max"]) await expect(page.locator(`.fbox[data-box="${key}"]`)).toHaveClass(/collapsed/);
});

for (const [w, hgt] of [[1280, 720], [1920, 1080]] as const) {
  test(`E2E-157 17 the armed tool's section is the first section of the right panel at ${w}x${hgt}; File, Counts and View keep their order and fold state`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: hgt });
    const t = helpers(page);
    await openRoom(page, t.exact);
    const first = () => page.evaluate(() => [...document.querySelectorAll<HTMLDetailsElement>("#inspector details[data-section]")].filter((d) => !d.hidden && d.getClientRects().length > 0).map((d) => `${d.dataset.section}:${d.open}`)[0]);
    const order = () => page.evaluate(() => [...document.querySelectorAll<HTMLDetailsElement>("#inspector details[data-section]")].filter((d) => !d.hidden && d.getClientRects().length > 0).map((d) => d.dataset.section));
    const open = (id: string) => page.locator(`details[data-section="${id}"]`).evaluate((d) => (d as HTMLDetailsElement).open);
    const fold = (id: string) => page.locator(`details[data-section="${id}"] > summary`);
    const idle = await order();
    expect(idle.slice(0, 3)).toEqual(["file", "counts", "view"]);
    await t.ctl("tool-cluster").click();
    expect(await first()).toBe("cluster:true");
    await fold("cluster").click(); // fold it while armed: respected
    expect(await open("cluster")).toBe(false);
    await t.ctl("tool-cluster").click(); // disarm: the section is gone
    expect(await order()).toEqual(idle);
    await t.ctl("tool-cluster").click(); // arm again: opens again, first again
    expect(await first()).toBe("cluster:true");
    expect((await order()).slice(1, 4)).toEqual(["file", "counts", "view"]);
    await t.ctl("tool-box").click();
    expect(await first()).toBe("box:true");
    await t.ctl("tool-box").click();
    expect(await first()).toBe("file:true");
    expect(await open("file")).toBe(true);
    expect(await open("counts")).toBe(true);
    expect(await open("view")).toBe(true);
  });
}

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
      await expandFilterBox(page, `filter-${endOn}-${side}`);
      const b = (await ctl(`filter-${endOn}-${side}`).boundingBox())!;
      expect(b.x, `${cube} ${endOn}-${side} inside`).toBeGreaterThanOrEqual(stageBox.x - 1);
    }
    // the in-view axes are not end-on, so at least one of their boxes sits off the left dock or above the end-on ones
    expect(Object.keys(e)).toHaveLength(6);
  }
  const front = await (async () => {
    await page.keyboard.press("3");
    await page.waitForTimeout(400);
    await expandFilterBox(page, "filter-z-max");
    await expandFilterBox(page, "filter-z-min");
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
    await expandFilterBox(page, "filter-x-min");
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
          fixed: ["#viewcube", "#camera-cluster", "#legend"].map((s) => ({ id: s, ...r(document.querySelector(s)!) })),
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
  await expandFilterBox(page, "filter-x-min");
  await ctl("filter-x-min").focus();
  await expect.poll(async () => (await planesNow(page)).map((q) => q.key)).toEqual(["x-min"]);
  await ctl("filter-x-min").evaluate((e) => (e as HTMLInputElement).blur());
  await expect.poll(async () => (await planesNow(page)).map((q) => q.key)).toEqual([]);
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
    history: () => page.locator("details[data-section=history] > p"), // "No edits yet" (an empty list has no height)
  };
  for (const id of Object.keys(probes)) {
    await expect(det(id)).toHaveAttribute("open", "");
    await expect(probes[id]()).toBeVisible();
  }
  await expect(det("view")).toBeVisible();
  const before = await page.locator("#counts-panel").innerText();
  // click collapses; the keyboard (Enter on the focused summary) toggles too
  for (const id of ["file", "counts", "view", "display"]) await sum(id).click();
  await sum("history").focus();
  await page.keyboard.press("Enter");
  for (const id of Object.keys(probes)) await expect(probes[id]()).toBeHidden();
  await ctl("tool-box").click();
  await expect(ctl("box-size-x")).toBeVisible();
  await sum("box").click();
  await expect(ctl("box-size-x")).toBeHidden();
  await expect.poll(async () => Object.keys(await SECTIONS_OPEN(page)).sort()).toEqual(["box", "counts", "display", "file", "history", "view"]);
  await page.waitForTimeout(1600); // the client state is saved one second after the last change
  await page.reload();
  await exact("Original", String(ROOM_TOTAL));
  await expect.poll(async () => Object.keys(await SECTIONS_OPEN(page)).sort()).toEqual(["box", "counts", "display", "file", "history", "view"]);
  for (const id of Object.keys(probes)) await expect(probes[id]()).toBeHidden();
  await ctl("tool-box").click();
  // 17: arming a tool opens its folded section (it is the first section of the panel); the other folds are untouched
  await expect(ctl("box-size-x")).toBeVisible();
  await expect.poll(async () => Object.keys(await SECTIONS_OPEN(page)).sort()).toEqual(["counts", "display", "file", "history", "view"]);
  // reopen all: nothing was lost and the counts read the same. The all-open state is also saved to the server (the next
  // test's page restores it), so this test leaves no folded section behind.
  const savedOpen = page.waitForRequest((r) => {
    if (r.method() !== "PUT" || !r.url().endsWith("/api/session/client-state")) return false;
    const folded = JSON.parse(r.postData() ?? "{}")?.ui?.sectionsOpen;
    return folded === undefined || Object.keys(folded).length === 0;
  });
  for (const id of ["file", "counts", "view", "display", "history"]) await sum(id).click();
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
    await pickPivotAt(page, [-1, 4, 4]);
    await base.ctl("tool-cluster").click();
    await unfold();
    await page.locator("#viewport").click(); // the armed Cluster tool waits for the seed click
    await expect(page.locator("#inspector")).toContainText("Seed: point");
    await base.setNum("cluster-radius", 1.1);
    await base.exact("Candidates", String(ROOM.wall));
    await base.ctl("apply").click();
    await base.exact("Active", String(ROOM_TOTAL - ROOM.ghost - ROOM.wall));
    await base.setNum("filter-z-min", 1);
    await base.exact("Displayed", String(ROOM.noise));
    await base.ctl("tool-cluster").click(); // Select displayed is refused while a tool is armed
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
  // the strip is a transparent overlay now: its own background is the timeline line (12-6)
  const sb = (await page.locator("#timeline .tl-line").boundingBox())!;
  await page.mouse.click(sb.x + sb.width - 6, sb.y + sb.height / 2);
  await expect.poll(async () => (await stepLayer(page)).visible).toBe(false);
});

for (const [w, hgt] of [[1280, 720], [1920, 1080]] as const) {
  test(`E2E-52 11 the strip overlays the bottom edge of the stage at ${w}x${hgt}, overlaps nothing and scrolls on its own with 25 steps`, async ({ page }) => {
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
    expect(tlb.h).toBeGreaterThanOrEqual(44); // the overlay band (BAND = 46 px), no longer a 60..68 px row under the stage
    expect(tlb.h).toBeLessThanOrEqual(48);
    expect(tlb.y).toBeGreaterThanOrEqual(r.stage!.y - 1); // strip is inside the stage's bounds
    expect(tlb.b).toBeLessThanOrEqual(r.stage!.b + 1);
    expect(r.stage!.b).toBeLessThanOrEqual(r.status!.y + 1); // above the status bar
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

/** The strip's own boxes against every other canvas control, for the six views (12-6, E2E-76). */
for (const [w, hgt] of [[1280, 720], [1920, 1080]] as const) {
  test(`E2E-76 12-6 the transparent timeline overlay never sits on a canvas control in views 1-6 and lets clicks through at ${w}x${hgt}`, async ({ page }) => {
    test.setTimeout(240000);
    await page.setViewportSize({ width: w, height: hgt });
    const t = tl(page);
    await t.threeSteps();
    const bg = await page.locator("#timeline").evaluate((e) => {
      const c = getComputedStyle(e);
      return { bg: c.backgroundColor, border: c.borderTopWidth, pe: c.pointerEvents, pos: c.position };
    });
    expect(bg.pos).toBe("absolute");
    expect(bg.pe).toBe("none");
    expect(bg.border).toBe("0px");
    expect(bg.bg).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    for (const key of ["1", "2", "3", "4", "5", "6"]) {
      await page.keyboard.press(key);
      await t.idle();
      const r = await page.evaluate(() => {
        const rect = (e: Element) => {
          const b = e.getBoundingClientRect();
          return { x: b.left, y: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height };
        };
        const all = (sel: string) => [...document.querySelectorAll(sel)].map(rect).filter((b) => b.w > 0 && b.h > 0);
        const strip = [...all("#timeline .step"), ...all("#timeline-marker"), ...all("#timeline .tl-line")];
        const others: [string, ReturnType<typeof rect>][] = [];
        for (const [name, sel] of [["legend", "#legend"], ["cube", "#viewcube .cube-stage"], ["arrow", "#viewcube .cube-arrow"], ["corner", "#viewcube .cube-corner:not([hidden])"], ["cluster", "#camera-cluster"], ["triad", "#triad"], ["box", "#fbox-layer .fbox"]] as const) {
          for (const b of all(sel)) others.push([name, b]);
        }
        const stage = rect(document.querySelector("#stage")!);
        const line = rect(document.querySelector("#timeline .tl-line")!);
        const free = { x: stage.x + stage.w * 0.5, y: stage.b - 3 };
        const top = document.elementFromPoint(free.x, free.y);
        const onLine = document.elementFromPoint(line.x + line.w - 6, line.y + line.h / 2);
        return { strip, others, stage, over: top?.id ?? top?.className ?? "", onLine: String(onLine?.className) };
      });
      expect(r.strip.length, `strip boxes in view ${key}`).toBeGreaterThanOrEqual(5);
      const hit = (a: { x: number; y: number; r: number; b: number }, b: { x: number; y: number; r: number; b: number }) => a.x < b.r && a.r > b.x && a.y < b.b && a.b > b.y;
      for (const [name, b] of r.others) for (const s of r.strip) expect(hit(s, b), `view ${key}: the strip overlaps ${name} at ${Math.round(b.x)},${Math.round(b.y)}`).toBe(false);
      for (const s of r.strip) {
        expect(s.y, `view ${key} strip top`).toBeGreaterThanOrEqual(r.stage.y - 1);
        expect(s.b, `view ${key} strip bottom`).toBeLessThanOrEqual(r.stage.b + 1);
      }
      expect(r.over, `view ${key}: a click on a free spot of the band goes to the canvas`).toBe("viewport");
      expect(r.onLine).toContain("tl-line");
    }
    await t.idle();
    await page.screenshot({ path: `/out/timeline-overlay-${w}.png` });
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
    await expect(page.locator("#inspector")).toContainText("Seed: point");
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
  await t.ctl("op-add").click();
  await t.pickSeed(CL.floor);
  await expect(page.locator("#draft-note")).toContainText("Preview, not applied"); // a draft: nothing grows until Commit draft
  await expect(t.ctl("apply")).toBeEnabled(); // owner ruling A (this asserted disabled before, only passing while the preview job was still busy)
  await t.exact("Selected", String(ROOM.wall));
  await t.ctl("sel-commit").click();
  await t.exact("Selected", String(ROOM.wall + FLOOR_CLUSTER));
  await t.exact("Candidates", String(ROOM.wall + FLOOR_CLUSTER));
  await expect(t.ctl("cluster-pick-seed")).toHaveAttribute("data-state", "waiting"); // 17: the tool stays armed and waits for its next seed
  await expect(t.ctl("apply")).toBeEnabled();
  await t.ctl("apply").click();
  await t.exact("Active", String(ROOM_TOTAL - ROOM.wall - FLOOR_CLUSTER));
  expect(t.confirms[0]).toContain(`${ROOM.wall + FLOOR_CLUSTER} of ${ROOM_TOTAL} points`);
  await t.expectActive(testInfo, (r) => inWall(r) || inFloorCluster(r));
});

test("E2E-150 17 Max points is an exact cap: 200 nearest points by hop, the note says so, Delete removes exactly them", async ({ page }, testInfo) => {
  const t = clusterHelpers(page);
  await openRoom(page, t.exact);
  await t.ctl("tool-cluster").click();
  await t.setNum("cluster-radius", 1.0);
  await t.ctl("cluster-max-points").fill("200");
  await t.ctl("cluster-max-points").press("Tab");
  await t.pickSeed(CL.floor);
  await t.exact("Selected", "200");
  await t.exact("Candidates", "200");
  await expect(page.locator("#cluster-limit")).toContainText("Stopped at limit 200");
  await expect(t.ctl("apply")).toBeEnabled();
  const seedText = await page.locator("#inspector").innerText();
  const seed = Number(/Seed: point (\d+)/.exec(seedText)![1]);
  const rows = parsePcd(roomPcd()).rows;
  const want = new Set(clusterNearestTruth(rows, seed, 1.0, 200).map((i) => f32key(rows[i])));
  expect(want.size).toBe(200);
  await t.ctl("apply").click();
  await t.exact("Active", String(ROOM_TOTAL - 200));
  await t.expectActive(testInfo, (r) => want.has(f32key(r)));
});

test("E2E-151 17 the Cluster block shows the pending preview's seed and size, then the committed cluster after Commit draft", async ({ page }) => {
  const t = clusterHelpers(page);
  await openRoom(page, t.exact);
  await t.ctl("tool-cluster").click();
  await t.setNum("cluster-radius", 1.1);
  await t.pickSeed(CL.wall);
  await t.exact("Selected", String(ROOM.wall));
  await t.ctl("op-add").click();
  await t.pickSeed(CL.floor);
  const seed = /Seed: point (\d+)/.exec(await page.locator("#inspector").innerText())![1];
  const result = page.locator("#cluster-result");
  await expect(result).toContainText("Preview, not committed");
  await expect(result.locator("dd").nth(0)).toHaveText(seed); // the floor pick's seed, not the wall's
  await expect(result.locator("dd").nth(2)).toHaveText(String(FLOOR_CLUSTER));
  await t.ctl("sel-commit").click();
  await t.exact("Selected", String(ROOM.wall + FLOOR_CLUSTER));
  await expect(result).not.toContainText("Preview, not committed");
  await expect(result.locator("dd").nth(0)).toHaveText(seed);
  await expect(result).toContainText("Candidates");
});

test("E2E-152 17 a blocked Delete says why in the Selection block, in the words of the Delete tooltip", async ({ page }) => {
  const t = helpers(page);
  await openRoom(page, t.exact);
  await t.ctl("tool-box").click();
  for (const [id, v] of [["box-center-x", -1], ["box-center-y", 4.5], ["box-center-z", 2.5], ["box-size-x", 1], ["box-size-y", 10], ["box-size-z", 5]] as const) await t.setNum(id, v);
  await t.exact("Selected", String(ROOM.wall));
  const note = page.locator("#delete-blocked");
  await expect(note).toBeHidden();
  await expect(t.ctl("apply")).toBeEnabled();
  await t.ctl("prot-mode").selectOption("override"); // no acknowledgement yet
  await expect(t.ctl("apply")).toBeDisabled();
  await expect(note).toBeVisible();
  const text = (await note.innerText()).trim();
  expect(text).toMatch(/^Delete is off: .+/);
  const reason = text.slice("Delete is off: ".length);
  expect(await t.ctl("apply").getAttribute("title")).toContain(`(${reason})`);
  if (/local protection interval/.test(reason)) {
    await t.setNum("prot-local-min", 50);
    await t.setNum("prot-local-max", 51);
  }
  await expect(note).toContainText("acknowledge");
  await t.ctl("prot-ack").check();
  await expect(note).toBeHidden();
  await expect(t.ctl("apply")).toBeEnabled();
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

test("E2E-63 Preview with a pending Add cluster draft keeps the draft; Apply stays enabled and deletes only the committed selection", async ({ page }, testInfo) => {
  const t = clusterHelpers(page);
  await openRoom(page, t.exact);
  await t.ctl("tool-cluster").click();
  await t.setNum("cluster-radius", 1.1);
  await t.pickSeed(CL.wall);
  await t.exact("Selected", String(ROOM.wall));
  await t.ctl("op-add").click();
  await t.pickSeed(CL.floor);
  await expect(page.locator("#draft-note")).toBeVisible();
  await t.ctl("preview").click();
  await expect(page.locator("#notices")).toContainText("Commit or discard the drafted tool shape first");
  await expect(page.locator("#draft-note")).toBeVisible();
  await expect(t.ctl("apply")).toBeEnabled(); // owner ruling A: a draft does not block Apply
  await t.exact("Selected", String(ROOM.wall));
  // Apply deletes exactly the committed selection (the wall); the floor cluster in the draft is not deleted.
  // Production (afterChange) clears the draft after any applied change, which plan 12b allows (E2E-84).
  await t.ctl("apply").click();
  await t.exact("Active", String(ROOM_TOTAL - ROOM.wall));
  await expect(page.locator("#draft-note")).toBeHidden();
  await t.expectActive(testInfo, inWall);
});

test("E2E-153 17 Commit draft leaves Cluster armed and waiting: two more clicks add two single points with no Pick point press", async ({ page }) => {
  const rows = finiteRows();
  const t = clusterHelpers(page);
  await openRoom(page, t.exact);
  await t.ctl("tool-cluster").click();
  await t.setNum("cluster-radius", 1.1);
  await t.pickSeed(CL.wall);
  await t.exact("Selected", String(ROOM.wall));
  await t.ctl("op-add").click();
  await t.pickSeed(CL.floor);
  await t.ctl("sel-commit").click();
  const floor = clusterTruth(rows, [...CL.floor], 1.1);
  await t.exact("Selected", String(ROOM.wall + floor.size));
  const pick = t.ctl("cluster-pick-seed");
  await expect(pick).toHaveAttribute("data-state", "waiting");
  const clickAt = async (at: number[]) => {
    const px = await page.evaluate((p) => (window as unknown as { __editor: EditorHook }).__editor.projectWorld(p as [number, number, number]), at);
    expect(px).not.toBeNull();
    await page.mouse.click(px!.x, px!.y);
    await expect(pick).toHaveAttribute("data-state", "set");
  };
  let total = ROOM.wall + floor.size;
  for (const noise of [[16.5, 3.5, 3], [8.5, 8.5, 2.5]]) {
    await clickAt(noise);
    const one = clusterTruth(rows, noise, 1.1);
    await t.ctl("sel-commit").click();
    total += one.size;
    await t.exact("Selected", String(total));
    await expect(pick).toHaveAttribute("data-state", "waiting");
  }
  await t.exact("Candidates", String(total));
});

test("E2E-64 Cluster Subtract and Intersect commit against the existing selection and Apply deletes exactly the result", async ({ page }, testInfo) => {
  const t = clusterHelpers(page);
  await openRoom(page, t.exact);
  await t.ctl("tool-cluster").click();
  await t.setNum("cluster-radius", 1.1);
  await t.ctl("tool-cluster").click(); // disarm: Select displayed is refused while a tool is armed
  await t.ctl("sel-select-displayed").click();
  await t.exact("Selected", String(ROOM_TOTAL - ROOM.invalid));
  await t.ctl("tool-cluster").click(); // arm again
  await t.ctl("op-subtract").click();
  await t.pickSeed(CL.wall);
  await t.ctl("sel-commit").click();
  await t.exact("Selected", String(ROOM_TOTAL - ROOM.invalid - ROOM.wall));
  await t.ctl("op-intersect").click();
  await t.pickSeed(CL.floor);
  await t.ctl("sel-commit").click();
  await t.exact("Selected", String(FLOOR_CLUSTER));
  await t.exact("Candidates", String(FLOOR_CLUSTER));
  await expect(t.ctl("cluster-pick-seed")).toHaveAttribute("data-state", "waiting");
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

for (const [w, hgt] of [[1280, 720], [1920, 1080]] as const) {
  test(`E2E-70 12-1 the top toolbar is one row of icon buttons with names, a visible focus ring and the help lamp at ${w}x${hgt}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: hgt });
    const { exact, ctl } = helpers(page);
    await openRoom(page, exact);
    for (const sel of ["#toolbar", "#viewbar", "#modebar"]) await expect(page.locator(sel)).toHaveCount(1); // E2E-21 skips a missing container
    const labels: Record<string, string> = { "open-file": "Open from this computer", "save-session": "Save session", export: "Export", undo: "Undo", redo: "Redo" };
    const ys: number[] = [];
    for (const [id, label] of Object.entries(labels)) {
      await expect(ctl(id)).toHaveCount(1);
      await expect(ctl(id)).toHaveAttribute("aria-label", label);
      await expect(ctl(id).locator("svg")).toHaveAttribute("aria-hidden", "true");
      await expect(ctl(id)).toHaveText("");
      const b = (await ctl(id).boundingBox())!;
      expect(b.width).toBeGreaterThanOrEqual(30);
      ys.push(b.y);
    }
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(2);
    expect((await page.locator("#toolbar").boundingBox())!.height).toBeLessThan(60); // one row
    await expect(ctl("help")).toHaveAttribute("aria-label", "Controls help");
    await expect(ctl("help")).toHaveText("");
    await expect(page.locator("#inspector")).not.toContainText("Navigation:");
    // keyboard: the first Tab stop is Open, with a visible focus ring
    await page.locator("body").click({ position: { x: 1, y: 1 } });
    await page.keyboard.press("Tab");
    await expect(ctl("open-file")).toBeFocused();
    expect(await ctl("open-file").evaluate((e) => getComputedStyle(e).outlineStyle)).not.toBe("none");
    // the lamp and the ? key both open the help overlay
    const help = page.locator("#help-overlay");
    await expect(help).not.toBeVisible();
    await ctl("help").click();
    await expect(help).toBeVisible();
    await ctl("help").click();
    await expect(help).not.toBeVisible();
    await page.locator("#viewport").hover();
    await page.keyboard.press("?");
    await expect(help).toBeVisible();
    await page.keyboard.press("Escape");
    await page.screenshot({ path: `/out/toolbar-${w}.png` });
  });
}

test("E2E-71 12-2 the four data modes are an icon group with exact counts; the opacity slider shows only in Overlay; Hold original and the O key are gone", async ({ page }) => {
  const { exact, ctl } = helpers(page);
  await openRoom(page, exact);
  const group = page.locator('[role="group"][aria-label="Data mode"]');
  await expect(group).toHaveCount(1);
  const ids = ["compare-original", "compare-edited", "compare-overlay", "compare-split"];
  const names = ["Original", "Edited", "Overlay", "Split"];
  const pressed = async (on: string) => {
    for (const id of ids) await expect(ctl(id)).toHaveAttribute("aria-pressed", id === on ? "true" : "false");
  };
  for (const [i, id] of ids.entries()) {
    await expect(ctl(id)).toHaveCount(1);
    await expect(ctl(id)).toHaveAttribute("aria-label", names[i]);
    await expect(ctl(id)).toHaveText("");
    await expect(group.locator(`[data-control="${id}"]`)).toHaveCount(1);
  }
  await pressed("compare-edited");
  await expect(ctl("overlay-opacity")).toHaveCount(0);
  const ys = await Promise.all(ids.map(async (id) => (await ctl(id).boundingBox())!.y));
  expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(2);
  // same counts as E2E-07
  await exact("Active", String(ROOM_TOTAL));
  await ctl("compare-overlay").click();
  await pressed("compare-overlay");
  await expect(page.locator("#modebar")).toContainText("View: Overlay (read-only)");
  await expect(page.locator("#counts-panel")).toContainText(`Deleted0 (`);
  await expect(ctl("overlay-opacity")).toHaveCount(1);
  await expect(ctl("overlay-opacity")).toBeVisible();
  await ctl("compare-split").click();
  await pressed("compare-split");
  await expect(page.locator("#modebar")).toContainText("View: Split (read-only)");
  await expect(ctl("overlay-opacity")).toHaveCount(0);
  await ctl("compare-original").click();
  await pressed("compare-original");
  await expect(page.locator("#modebar")).toContainText("View: Original (read-only)");
  await ctl("compare-edited").click();
  await pressed("compare-edited");
  await expect(page.locator("#modebar")).not.toContainText("View:");
  await exact("Active", String(ROOM_TOTAL));
  // Hold original is gone, and O changes nothing
  await expect(ctl("compare-hold-original")).toHaveCount(0);
  await page.locator("#viewport").hover();
  await page.keyboard.down("o");
  await expect(page.locator("#modebar")).not.toContainText("View:");
  await page.keyboard.up("o");
  await pressed("compare-edited");
  await page.keyboard.press("?");
  await expect(page.locator("#help-overlay td.k", { hasText: /^O/ })).toHaveCount(0);
  await expect(page.locator("#help-overlay")).not.toContainText("original cloud while held");
});

for (const [w, hgt] of [[1280, 720], [1920, 1080]] as const) {
  test(`E2E-72 12-3 16-2 the camera cluster sits above the ViewCube, overlaps nothing, resets and picks the pivot; no typed pivot at ${w}x${hgt}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: hgt });
    const { exact, ctl } = helpers(page);
    await openRoom(page, exact);
    const cluster = page.locator("#camera-cluster");
    await expect(cluster).toHaveCount(1);
    await expect(page.locator("#viewcube")).toHaveCount(1);
    const ids = ["view-perspective", "fit-cloud", "pivot-reset", "pivot-pick"];
    await expect(cluster.locator("[data-control]")).toHaveCount(4);
    expect(await cluster.locator("[data-control]").evaluateAll((els) => els.map((e) => e.getAttribute("data-control")))).toEqual(ids);
    for (const id of ids) {
      await expect(ctl(id)).toHaveText("");
      expect((await ctl(id).boundingBox())!.width).toBeGreaterThanOrEqual(30);
    }
    for (const gone of ["pivot-x", "pivot-y", "pivot-z", "pivot-set"]) await expect(ctl(gone)).toHaveCount(0);
    await expect(page.locator("#viewbar").locator('[data-control="pivot-reset"]')).toHaveCount(0);
    const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
    const c = await box("#camera-cluster");
    const stage = await box("#stage");
    expect(c.x).toBeGreaterThanOrEqual(stage.x);
    expect(c.x + c.width).toBeLessThanOrEqual(stage.x + stage.width);
    expect(c.y).toBeGreaterThanOrEqual(stage.y);
    expect(c.y + c.height).toBeLessThanOrEqual(stage.y + stage.height);
    const hit = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    expect(hit(c, await box("#viewcube")), "cluster vs #viewcube").toBe(false);
    expect(c.y + c.height).toBeLessThanOrEqual((await box("#viewcube")).y);
    const fboxes = await page.locator(".fbox").all();
    expect(fboxes.length).toBeGreaterThan(0);
    for (const f of fboxes) expect(hit(c, (await f.boundingBox())!), "cluster vs .fbox").toBe(false);
    const notices = page.locator("#notices");
    if (await notices.locator(".notice").count()) expect(hit(c, await box("#notices"))).toBe(false);
    // projection: pressed while perspective, the icon follows
    await expect(ctl("view-perspective")).toHaveAttribute("aria-pressed", "true");
    await expect(ctl("view-perspective").locator("svg")).toHaveAttribute("data-icon", "persp");
    await ctl("view-perspective").click();
    await expect(ctl("view-perspective")).toHaveAttribute("aria-pressed", "false");
    await expect(ctl("view-perspective").locator("svg")).toHaveAttribute("data-icon", "ortho");
    await expect(page.locator("#inspector")).toContainText("Orthographic");
    await ctl("view-perspective").click();
    // pick: arm, the button is pressed, Esc disarms; the click sets the pivot; reset returns it to the cloud centre
    await ctl("cube-top").click();
    await ctl("pivot-pick").click();
    await expect(ctl("pivot-pick")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(page.locator("#modebar")).toContainText("Tool: None");
    await expect(ctl("pivot-pick")).toHaveAttribute("aria-pressed", "false");
    await ctl("pivot-reset").click();
    await expect(page.locator("#inspector")).toContainText("Pivot9, 9.5, 2");
    await pickPivotAt(page, [15, 2, 0]);
    await expect(page.locator("#inspector")).toContainText("Pivot15, 2, 0");
    await expect(ctl("pivot-pick")).toHaveAttribute("aria-pressed", "false");
    await ctl("pivot-reset").click();
    await expect(page.locator("#inspector")).toContainText("Pivot9, 9.5, 2");
    await page.screenshot({ path: `/out/camera-cluster-${w}.png` });
  });
}

for (const [w, hgt] of [[1280, 720], [1920, 1080]] as const) {
  test(`E2E-132 16-2 the cluster is above a smaller ViewCube and nothing in the top-right corner overlaps in Front, Left, Top and Back at ${w}x${hgt}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: hgt });
    const { exact } = helpers(page);
    await openRoom(page, exact);
    for (const [key, view] of [["3", "front"], ["5", "left"], ["1", "top"], ["4", "back"]] as const) {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press(key);
      await page.waitForTimeout(400);
      const r = await page.evaluate(() => {
        const rect = (e: Element) => {
          const b = e.getBoundingClientRect();
          return { l: b.left, t: b.top, r: b.right, b: b.bottom };
        };
        const one = (s: string) => {
          const e = document.querySelector(s);
          return e ? rect(e) : null;
        };
        return {
          stage: one("#stage")!,
          cluster: one("#camera-cluster")!,
          cube: one("#viewcube")!,
          cubeStage: one("#viewcube .cube-stage")!,
          parts: [...document.querySelectorAll("#viewcube .cube-arrow, #viewcube .cube-corner")].filter((e) => !(e as HTMLButtonElement).disabled && !(e as HTMLElement).hidden).map(rect),
          boxes: [...document.querySelectorAll(".fbox")].map((e) => ({ id: (e as HTMLElement).dataset.box!, ...rect(e) })),
          others: ["#legend", "#triad", "#timeline", "#notices"].flatMap((s) => {
            const x = one(s);
            return x && x.r > x.l && x.b > x.t ? [{ id: s, ...x }] : [];
          }),
        };
      });
      type R = { l: number; t: number; r: number; b: number };
      const hit = (a: R, b: R) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
      const tag = `${w} ${view}`;
      expect(r.cluster.b, `${tag} cluster above cube`).toBeLessThanOrEqual(r.cube.t);
      expect(r.cluster.l >= r.stage.l && r.cluster.r <= r.stage.r && r.cluster.t >= r.stage.t, `${tag} cluster inside stage`).toBe(true);
      expect(r.cubeStage.r - r.cubeStage.l, `${tag} cube stage width`).toBeLessThanOrEqual(80);
      expect(hit(r.cluster, r.cubeStage), `${tag} cluster x cube stage`).toBe(false);
      for (const a of r.parts) expect(hit(r.cluster, a), `${tag} cluster x arrow or zone`).toBe(false);
      for (const o of [...r.boxes, ...r.others]) {
        for (const [name, rc] of [["cluster", r.cluster], ["cube", r.cube], ["cube stage", r.cubeStage]] as const) expect(hit(o, rc), `${tag} ${o.id} x ${name}`).toBe(false);
        for (const a of r.parts) expect(hit(o, a), `${tag} ${o.id} x arrow or zone`).toBe(false);
      }
      await page.screenshot({ path: `/out/viewcube-${w}-${view}.png` });
    }
  });
}

for (const [w, hgt] of [[1280, 720], [1920, 1080]] as const) {
  test(`E2E-73 12-4 ViewCube arrows: faint at rest, clear on hover, each reaches its face (hidden ones too); corner zones snap diagonally at ${w}x${hgt}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: hgt });
    const { exact, ctl } = helpers(page);
    await openRoom(page, exact);
    const opacity = (id: string) => ctl(id).evaluate((e) => Number(getComputedStyle(e).opacity));
    for (const n of NAMES) await expect(ctl(`arrow-${n}`)).toHaveCount(1);
    await expect(page.locator(".cube-corner")).toHaveCount(8);
    await page.locator("#viewport").hover();
    await expect.poll(() => opacity("arrow-top")).toBeLessThan(0.2);
    await ctl("cube-top").hover();
    await expect.poll(() => opacity("arrow-top")).toBeGreaterThan(0.8);
    await page.screenshot({ path: `/out/viewcube-arrows-default-${w}.png`, clip: (await page.locator("#viewcube").boundingBox())! });
    // the arrows sit inside the stage and around, not on, the cube
    const stage = (await page.locator("#stage").boundingBox())!;
    const cube = (await ctl("cube-top").boundingBox())!;
    for (const n of NAMES) {
      const a = (await ctl(`arrow-${n}`).boundingBox())!;
      expect(a.x, n).toBeGreaterThanOrEqual(stage.x);
      expect(a.x + a.width, n).toBeLessThanOrEqual(stage.x + stage.width);
      expect(a.y, n).toBeGreaterThanOrEqual(stage.y);
      expect(a.width, n).toBeGreaterThanOrEqual(22);
    }
    // every arrow, including the faces hidden at the start, turns the view to its face
    for (const n of [...NAMES, "bottom", "top"]) {
      const hiddenBefore = (await ctl(`cube-${n}`).getAttribute("data-facing")) === "false";
      await ctl(`arrow-${n}`).click();
      const c = await cameraLookUp(page);
      PRESET_LOOK_UP[n].look.forEach((v, i) => expect(c.look[i], `${n} look`).toBeCloseTo(v, 6));
      expect(c.ortho).toBe(true);
      await expect(ctl(`cube-${n}`)).toHaveAttribute("data-facing", "true");
      if (hiddenBefore) await page.screenshot({ path: `/out/viewcube-arrows-${n}-${w}.png`, clip: (await page.locator("#viewcube").boundingBox())! });
    }
    // the cube is still clickable through the wrapper
    await ctl("cube-top").click();
    await expect(ctl("cube-top")).toHaveAttribute("data-facing", "true");
    expect(cube.width).toBeGreaterThan(0);
    // a corner zone looks along minus the sum of the normals of its three faces, Z up
    await ctl("view-perspective").click();
    const zone = page.locator(".cube-corner:not([hidden])").first();
    const id = (await zone.getAttribute("data-control"))!;
    await zone.click();
    const faces = id.slice(7).split("-");
    const sum = [0, 0, 0];
    for (const f of faces) PRESET_LOOK_UP[f].look.forEach((v, i) => (sum[i] -= v));
    const len = Math.hypot(...sum);
    const c = await cameraLookUp(page);
    sum.forEach((v, i) => expect(c.look[i], `${id} look`).toBeCloseTo(-v / len, 5));
    expect(c.ortho).toBe(true);
    await page.screenshot({ path: `/out/viewcube-corner-${w}.png`, clip: (await page.locator("#viewcube").boundingBox())! });
    // reduced motion turns the fade off
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await ctl("arrow-top").evaluate((e) => getComputedStyle(e).transitionDuration)).toMatch(/^0s(, 0s)*$/);
  });

  test(`E2E-74 12-4 the XYZ triad sits bottom-left of the stage and overlaps no box, cube, cluster or legend in Front, Left, Top and Back at ${w}x${hgt}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: hgt });
    const { exact, ctl } = helpers(page);
    await openRoom(page, exact);
    await expect(page.locator("#triad")).toHaveCount(1);
    await expect(page.locator("#axis-legend")).toHaveCount(0);
    await expect(page.locator("#viewcube .cube-triad")).toHaveCount(0);
    const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
    const hit = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    for (const view of ["front", "left", "top", "back"]) {
      await ctl(`arrow-${view}`).click(); // reaches the face even when it is not visible
      await expect(ctl(`cube-${view}`)).toHaveAttribute("data-facing", "true");
      const stage = await box("#stage");
      const t = await box("#triad");
      expect(t.x, view).toBeLessThan(stage.x + stage.width / 4);
      expect(t.y, view).toBeGreaterThan(stage.y + stage.height / 2);
      expect(t.x).toBeGreaterThanOrEqual(stage.x);
      expect(t.y + t.height).toBeLessThanOrEqual(stage.y + stage.height);
      for (const sel of ["#viewcube", "#camera-cluster", "#legend"]) expect(hit(t, await box(sel)), `${view}: triad vs ${sel}`).toBe(false);
      for (const f of await page.locator(".fbox").all()) expect(hit(t, (await f.boundingBox())!), `${view}: triad vs .fbox`).toBe(false);
      if (view === "front") await page.screenshot({ path: `/out/triad-${w}.png` });
    }
  });
}

for (const [w, hgt] of [[1280, 720], [1920, 1080]] as const) {
  test(`E2E-75 12-5 the legend is a menu, open by default, folding by click and keyboard survives a reload, and it holds the mode line without overlapping boxes or the cube at ${w}x${hgt}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: hgt });
    const { exact, ctl } = helpers(page);
    await openRoom(page, exact);
    for (const sel of ["#legend", "#legend-menu", "#modebar"]) await expect(page.locator(sel)).toHaveCount(1);
    await expect(page.locator('#legend [data-legend="selected"]')).toBeVisible();
    await expect(page.locator("#legend #modebar")).toBeVisible();
    await expect(page.locator("#modebar")).toContainText("Tool: None");
    await expect(ctl("legend-menu")).toHaveAttribute("aria-expanded", "true");
    await expect(ctl("legend-menu")).toHaveAttribute("aria-label", "Legend menu");
    const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
    const hit = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    for (const view of ["front", "top", "left"]) {
      await ctl(`arrow-${view}`).click();
      const l = await box("#legend");
      for (const sel of ["#viewcube", "#camera-cluster", "#triad"]) expect(hit(l, await box(sel)), `${view}: legend vs ${sel}`).toBe(false);
      for (const f of await page.locator(".fbox").all()) expect(hit(l, (await f.boundingBox())!), `${view}: legend vs .fbox`).toBe(false);
    }
    await page.screenshot({ path: `/out/legend-open-${w}.png`, clip: { ...(await box("#legend")), x: 0, y: (await box("#stage")).y, width: 260 } });
    // the mode line keeps reporting Pick pivot
    await ctl("pivot-pick").click();
    await expect(page.locator("#modebar")).toContainText("Tool: Pick pivot");
    await page.keyboard.press("Escape");
    // fold by click, unfold by Enter, fold by Space
    await ctl("legend-menu").click();
    await expect(ctl("legend-menu")).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator('#legend [data-legend="selected"]')).toBeHidden();
    await expect(page.locator("#modebar")).toBeHidden();
    await page.screenshot({ path: `/out/legend-closed-${w}.png`, clip: { ...(await box("#legend")), x: 0, y: (await box("#stage")).y, width: 260 } });
    await ctl("legend-menu").focus();
    await page.keyboard.press("Enter");
    await expect(ctl("legend-menu")).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator('#legend [data-legend="selected"]')).toBeVisible();
    await page.keyboard.press("Space");
    await expect(ctl("legend-menu")).toHaveAttribute("aria-expanded", "false");
    // folded, the boxes do not move (the reserved rectangle is the expanded size)
    const folded = await page.locator(".fbox").evaluateAll((els) => els.map((e) => (e as HTMLElement).style.transform || `${(e as HTMLElement).style.left},${(e as HTMLElement).style.top}`));
    await ctl("legend-menu").click();
    const open = await page.locator(".fbox").evaluateAll((els) => els.map((e) => (e as HTMLElement).style.transform || `${(e as HTMLElement).style.left},${(e as HTMLElement).style.top}`));
    expect(open).toEqual(folded);
    // the folded state survives a reload
    const savedFolded = page.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith("/api/session/client-state") && JSON.parse(r.postData() ?? "{}")?.ui?.legendOpen === false);
    await ctl("legend-menu").click();
    await savedFolded;
    await page.reload();
    await exact("Original", String(ROOM_TOTAL));
    await expect(ctl("legend-menu")).toHaveAttribute("aria-expanded", "false");
    // leave the session unfolded for the next test
    const savedOpen = page.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith("/api/session/client-state") && JSON.parse(r.postData() ?? "{}")?.ui?.legendOpen === undefined);
    await ctl("legend-menu").click();
    await savedOpen;
    await expect(ctl("legend-menu")).toHaveAttribute("aria-expanded", "true");
  });
}

/** The brightest pixel of a (2r+1) square of the page around a screen point, read from a screenshot decoded in a blank tab (the app's CSP is not involved). */
async function brightestPixel(page: import("@playwright/test").Page, at: { x: number; y: number }, r = 4): Promise<number[]> {
  const buf = await page.screenshot({ clip: { x: Math.round(at.x) - r, y: Math.round(at.y) - r, width: 2 * r + 1, height: 2 * r + 1 } });
  const tab = await page.context().newPage();
  try {
    return await tab.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d")!;
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let best = [0, 0, 0];
      let score = -1;
      for (let i = 0; i < d.length; i += 4) {
        const sum = d[i] + d[i + 1] + d[i + 2];
        if (sum > score) {
          score = sum;
          best = [d[i], d[i + 1], d[i + 2]];
        }
      }
      return best;
    }, buf.toString("base64"));
  } finally {
    await tab.close();
  }
}

test("E2E-77 12-7 colour modes Turbo (default), Viridis and Grey: the select lists them (and Distance after them), the legend shows the active ramp with the cloud's height range, the drawn colour of a fixed wall point differs per mode", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const { exact, ctl } = helpers(page);
  await openRoom(page, exact);
  const modes = ctl("colour-mode");
  expect(await modes.locator("option").evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value))).toEqual(["turbo", "viridis", "flat", "distance", "normals"]);
  expect(await modes.locator("option").evaluateAll((o) => o.map((x) => x.textContent))).toEqual(["Height (Turbo)", "Height (Viridis)", "Grey", "Distance to viewer", "Normal shading"]);
  await expect(modes).toHaveValue("turbo");
  await expect(page.locator("#legend-ramp")).toHaveCount(1);
  const wall = await settledScreen(page, [-1, 5, 3]);
  const sum = (a: number[], b: number[]) => a.reduce((t, v, i) => t + Math.abs(v - b[i]), 0);
  const read = () => brightestPixel(page, wall);
  await expect(page.locator("#legend-ramp")).toHaveAttribute("data-ramp", "turbo");
  await expect(page.locator("#legend-ramp")).toContainText("Height (Turbo)");
  await expect(page.locator("#legend-ramp .ramp-min")).toHaveText("0 m");
  await expect(page.locator("#legend-ramp .ramp-max")).toHaveText("4 m");
  await expect(page.locator("#legend-ramp .ramp-bar")).toBeVisible();
  const turbo = await read();
  await page.screenshot({ path: "/out/colour-turbo.png" });
  await page.locator("#legend").screenshot({ path: "/out/legend-turbo.png" });
  await modes.selectOption("viridis");
  await expect(page.locator("#legend-ramp")).toHaveAttribute("data-ramp", "viridis");
  await expect(page.locator("#legend-ramp")).toContainText("Height (Viridis)");
  await expect.poll(async () => sum(turbo, await read()), { timeout: 5000 }).toBeGreaterThan(40);
  const viridis = await read();
  await page.screenshot({ path: "/out/colour-viridis.png" });
  await page.locator("#legend").screenshot({ path: "/out/legend-viridis.png" });
  await modes.selectOption("flat");
  await expect(page.locator("#legend-ramp")).toBeHidden();
  await expect.poll(async () => sum(viridis, await read()), { timeout: 5000 }).toBeGreaterThan(40);
  const grey = await read();
  expect(Math.max(...grey) - Math.min(...grey), `grey pixel ${grey}`).toBeLessThanOrEqual(6);
  await page.screenshot({ path: "/out/colour-flat.png" });
  await page.locator("#legend").screenshot({ path: "/out/legend-flat.png" });
  await expect(page.locator('#legend [data-legend="base"]')).toHaveCSS("background-color", "rgb(176, 176, 176)");
  await modes.selectOption("turbo");
});

test("E2E-78 12-8 Distance to viewer: the legend reads near to far, the drawn colour of a fixed point follows the view, a selected point keeps its selection colour, the console stays clean", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" || /shader|WebGL|GL_INVALID/i.test(m.text())) errors.push(m.text());
  });
  const { exact, ctl } = helpers(page);
  await openRoom(page, exact);
  const modes = ctl("colour-mode");
  await expect(modes.locator('option[value="distance"]')).toHaveText("Distance to viewer");
  const sum = (a: number[], b: number[]) => a.reduce((t, v, i) => t + Math.abs(v - b[i]), 0);
  // an isolated noise point (nothing else shares its screen position from the front or the back)
  const lone = [16.5, 3.5, 3];
  const pixel = async () => brightestPixel(page, await settledScreen(page, lone));
  await modes.selectOption("distance");
  await expect(page.locator("#legend-ramp")).toHaveAttribute("data-ramp", "distance");
  await expect(page.locator("#legend-ramp .ramp-min")).toHaveText("near");
  await expect(page.locator("#legend-ramp .ramp-max")).toHaveText("far");
  // the same world point is nearer to a viewer in front of the room (y 0 side) than to one behind it
  await ctl("arrow-front").click();
  await expect(ctl("cube-front")).toHaveAttribute("data-facing", "true");
  const fromFront = await pixel();
  await page.screenshot({ path: "/out/distance-front.png" });
  await page.locator("#legend").screenshot({ path: "/out/legend-distance.png" });
  await ctl("arrow-back").click();
  await expect(ctl("cube-back")).toHaveAttribute("data-facing", "true");
  const fromBack = await pixel();
  await page.screenshot({ path: "/out/distance-back.png" });
  expect(sum(fromFront, fromBack), `front ${fromFront} back ${fromBack}`).toBeGreaterThan(60);
  // the near end is the light stop, the far end the dark one
  expect(fromFront[0] + fromFront[1] + fromFront[2]).toBeGreaterThan(fromBack[0] + fromBack[1] + fromBack[2]);
  // a wheel dolly keeps drawing without errors
  const box = (await page.locator("#viewport").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400);
  await page.mouse.wheel(0, 200);
  await expect.poll(() => hook(page, (e) => e.drawnCount())).toBeGreaterThan(0);
  // a selected point keeps the selection colour (the shader leaves flagged points alone)
  await modes.selectOption("turbo");
  await ctl("sel-select-displayed").click();
  await expect.poll(async () => (await page.locator('#statusbar [data-status="Selected"]').innerText()).replace(/\D/g, ""), { timeout: 15000 }).not.toBe("0");
  const selectedTurbo = await pixel();
  await modes.selectOption("distance");
  await expect.poll(async () => sum(selectedTurbo, await pixel()), { timeout: 5000 }).toBeLessThanOrEqual(6);
  expect(errors).toEqual([]);
});

test("E2E-78 12-8 the interaction LOD still draws at most 200k points during an orbit drag in Distance mode and the full draw returns after idle", async ({ page }) => {
  test.setTimeout(240000);
  const { exact, ctl } = helpers(page);
  const total = BIG.floor + BIG.ghost;
  await page.goto("/");
  await page.locator("#file-input").setInputFiles({ name: "big.pcd", mimeType: "application/octet-stream", buffer: bigRoomPcd(bigRoomXyz()) });
  await exact("Original", total.toLocaleString("en-US"));
  await ctl("colour-mode").selectOption("distance");
  await expect.poll(() => hook(page, (e) => e.drawnCount()), { timeout: 15000 }).toBe(total);
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
  expect(Math.min(...during)).toBeGreaterThan(100_000);
  await page.mouse.up();
  await expect.poll(() => hook(page, (e) => e.drawnCount()), { timeout: 5000 }).toBe(total);
});

test("E2E-79 12-9 Normal shading: the legend shows the X/Y/Z swatches, a floor point and a wall point are drawn in different hues (floor blue-ish, wall red-ish), the console stays clean, and the saved mode restores after a save and reopen", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const { exact, ctl } = helpers(page);
  await page.goto("/");
  await page.locator("#file-input").setInputFiles({ name: "room.pcd", mimeType: "application/octet-stream", buffer: normalRoomPcd() });
  await exact("Original", NORMAL_ROOM_TOTAL.toLocaleString("en-US"));
  const modes = ctl("colour-mode");
  await expect(modes.locator('option[value="normals"]')).toHaveText("Normal shading");
  await modes.selectOption("normals");
  await expect(page.locator("#legend-ramp")).toHaveAttribute("data-ramp", "normals");
  await expect(page.locator("#legend-ramp")).toContainText("Normal shading");
  await expect(page.locator("#legend-ramp [data-swatch]")).toHaveCount(3);
  await expect(page.locator("#legend-ramp .ramp-bar")).toBeHidden();
  await expect(page.locator("#legend-ramp")).toHaveAttribute("aria-label", /Normal shading, X, Y, Z/);
  await expect(page.locator('#legend [data-legend="base"]')).toBeVisible();
  const wall = await settledScreen(page, [-5, 10, 2]);
  const floor = await settledScreen(page, [10, 10, 0]);
  await expect.poll(async () => (await brightestPixel(page, floor)).join(","), { timeout: 15000 }).not.toBe("0,0,0");
  const f = await brightestPixel(page, floor);
  const w = await brightestPixel(page, wall);
  await page.screenshot({ path: "/out/colour-normals.png" });
  await page.locator("#legend").screenshot({ path: "/out/legend-normals.png" });
  expect(f[2] - f[0], `floor pixel ${f}`).toBeGreaterThan(20); // +Z reads blue
  expect(w[0] - w[2], `wall pixel ${w}`).toBeGreaterThan(20); // a wall along x reads red
  expect(errors).toEqual([]);
  // save and reopen: the mode comes back
  await expect(modes).toHaveValue("normals");
  const [dl] = await Promise.all([page.waitForEvent("download"), ctl("save-session").click()]);
  const path = testInfo.outputPath("normals.pcdsession");
  await dl.saveAs(path);
  await page.locator("#file-input").setInputFiles({ name: "other.pcd", mimeType: "application/octet-stream", buffer: syntheticPcd() });
  await exact("Active", String(TOTAL));
  await modes.selectOption("flat");
  await page.locator("#file-input").setInputFiles({ name: "room_session_v1.pcdsession", mimeType: "application/octet-stream", buffer: readFileSync(path) });
  await exact("Original", NORMAL_ROOM_TOTAL.toLocaleString("en-US"));
  await expect(ctl("colour-mode")).toHaveValue("normals");
});


// ---- part 12b: live preview of Add / Subtract / Intersect (E2E-80..87)
const finiteRows = () => parsePcd(roomPcd()).rows.filter((r) => r.every(Number.isFinite));
const inBox = (r: number[], c: number[], d: number[]) => [0, 1, 2].every((i) => Math.abs(r[i] - c[i]) <= d[i] / 2 + 1e-9);
const rowId = (r: number[]) => r.map(Math.fround).join(",");
/** Independent oracle: points reachable from the seed row through steps of at most `radius` (BFS over the valid rows). */
function clusterTruth(rows: number[][], seed: number[], radius: number, skip: (r: number[]) => boolean = () => false): Set<string> {
  const pool = rows.filter((r) => !skip(r));
  const start = pool.find((r) => r[0] === seed[0] && r[1] === seed[1] && r[2] === seed[2]);
  const out = new Set<string>();
  if (!start) return out;
  const todo = [start];
  out.add(rowId(start));
  while (todo.length) {
    const a = todo.pop()!;
    for (const b of pool) {
      if (out.has(rowId(b))) continue;
      if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= radius) {
        out.add(rowId(b));
        todo.push(b);
      }
    }
  }
  return out;
}

function previewHelpers(page: import("@playwright/test").Page) {
  const t = clusterHelpers(page);
  const posts = { preview: 0, commit: 0, select: 0, discard: 0 };
  page.on("request", (r) => {
    if (r.method() !== "POST") return;
    const u = new URL(r.url()).pathname;
    if (u.endsWith("/selection/preview")) posts.preview++;
    else if (u.endsWith("/selection/commit")) posts.commit++;
    else if (u.endsWith("/selection/preview/discard")) posts.discard++;
    else if (u.endsWith("/session/selection")) posts.select++;
  });
  const note = page.locator("#draft-note");
  const legend = (id: string) => page.locator(`[data-legend="${id}"]`);
  const layer = () => hook(page, (e) => e.previewLayer());
  const box = () => hook(page, (e) => ({ c: [...e.state().tools.box.center], d: [...e.state().tools.box.dimensions] }));
  const setBox = async (c: number[], d: number[]) => {
    for (const [id, v] of [["box-center-x", c[0]], ["box-center-y", c[1]], ["box-center-z", c[2]], ["box-size-x", d[0]], ["box-size-y", d[1]], ["box-size-z", d[2]]] as const) await t.setNum(id, v);
  };
  const WALL_BOX = [[-1, 4.5, 2.5], [1, 10, 5]] as const;
  /** Open the room with the wall committed as the selection by a Replace box (live). */
  const wallSelected = async () => {
    await openRoom(page, t.exact);
    await t.ctl("cube-top").click();
    await t.ctl("tool-box").click();
    await setBox([...WALL_BOX[0]], [...WALL_BOX[1]]);
    await t.exact("Selected", String(ROOM.wall));
    await t.exact("Candidates", String(ROOM.wall));
  };
  /** The note announces a finished preview with `after` selected points. */
  const previewIs = async (after: number) => {
    await expect(note).toContainText("Preview, not applied", { timeout: 15000 });
    await expect(note).toContainText(`select ${after.toLocaleString("en-US")} points`, { timeout: 15000 });
  };
  const previewLeaves = async (after: number) => {
    await expect(note).toContainText("Preview, not applied", { timeout: 15000 });
    await expect(note).toContainText(`leave ${after.toLocaleString("en-US")} selected`, { timeout: 15000 });
  };
  return { ...t, posts, note, legend, layer, box, setBox, wallSelected, previewIs, previewLeaves };
}

const GHOST_BOX = { c: [3, 13, 2], d: [3, 3, 3] };

test("E2E-80 12b Box Add: the real mouse drags the box over the ghosts, the preview shows them in the add colour, Selected stays until Commit draft", async ({ page }) => {
  const t = previewHelpers(page);
  await t.wallSelected();
  await t.ctl("op-add").click();
  await t.setBox(GHOST_BOX.c, GHOST_BOX.d);
  const rows = finiteRows();
  const wallRows = rows.filter((r) => inBox(r, [...[-1, 4.5, 2.5]], [1, 10, 5]));
  expect(wallRows.length).toBe(ROOM.wall);
  const added0 = rows.filter((r) => inBox(r, GHOST_BOX.c, GHOST_BOX.d)).length;
  expect(added0).toBe(ROOM.ghost);
  await t.previewIs(ROOM.wall + added0);
  await t.exact("Selected", String(ROOM.wall));
  await t.exact("Candidates", String(ROOM.wall));
  await expect(t.legend("preview-add")).toBeVisible();
  await expect(t.legend("preview-remove")).toHaveCount(0);
  await expect.poll(async () => (await t.layer()).add).toBe(added0);
  await page.waitForTimeout(300);
  await page.screenshot({ path: "/out/preview-add.png" });
  // a real drag on the +X handle widens the box; the preview follows the final box (fixture truth from the box the app holds)
  await page.waitForTimeout(400);
  const handle = (await hook(page, (e) => e.handlePositions())).find((p) => p.id === "resize-0+")!;
  const before = t.posts.preview;
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(handle.x + 40, handle.y, { steps: 6 });
  await page.mouse.move(handle.x + 80, handle.y, { steps: 6 });
  await page.mouse.up();
  const b = await t.box();
  expect(b.d[0]).toBeGreaterThan(GHOST_BOX.d[0]);
  const union = new Set([...wallRows, ...rows.filter((r) => inBox(r, b.c, b.d))].map(rowId)).size;
  const added = union - ROOM.wall;
  await t.previewIs(union);
  await expect.poll(async () => (await t.layer()).add).toBe(added);
  expect(t.posts.preview - before).toBeLessThanOrEqual(2); // one request per pause, not one per mouse move
  await t.exact("Selected", String(ROOM.wall));
  await t.exact("Candidates", String(ROOM.wall));
  await t.ctl("sel-commit").click();
  await t.exact("Selected", String(union));
  await expect(t.note).toBeHidden();
  await expect(t.legend("preview-add")).toHaveCount(0);
  expect(t.posts.commit).toBe(1);
  await expect.poll(async () => (await t.layer()).add).toBe(0);
});

for (const op of ["subtract", "intersect"] as const) {
  test(`E2E-81 12b Box ${op}: the preview count is fixture truth, removed points show in the remove colour, Selected stays until Commit draft`, async ({ page }) => {
    const t = previewHelpers(page);
    await t.wallSelected();
    await t.ctl("tool-box").click(); // disarm: Select displayed is refused while a tool is armed
    await t.ctl("sel-select-displayed").click();
    await t.ctl("tool-box").click(); // arm again
    const all = ROOM_TOTAL - ROOM.invalid;
    await t.exact("Selected", String(all));
    await t.ctl(`op-${op}`).click();
    const c = [3, 13, 2];
    const d = [3, 3, 3];
    await t.setBox(c, d);
    const rows = finiteRows();
    const inside = rows.filter((r) => inBox(r, c, d)).length;
    const left = op === "subtract" ? all - inside : inside;
    const removed = all - left;
    await t.previewLeaves(left);
    await expect(t.legend("preview-remove")).toBeVisible();
    await expect(t.legend("preview-add")).toHaveCount(0);
    await expect.poll(async () => (await t.layer()).remove).toBe(removed);
    await t.exact("Selected", String(all));
    await t.ctl("sel-commit").click();
    await t.exact("Selected", String(left));
    await expect(t.note).toBeHidden();
    await expect(t.legend("preview-remove")).toHaveCount(0);
  });
}

test("E2E-82 12b Polygon Add: real clicks draw the polygon, the preview is the union with the selection, Selected stays until Commit draft", async ({ page }) => {
  const t = previewHelpers(page);
  await t.wallSelected();
  await t.ctl("tool-polygon").click();
  await t.ctl("op-add").click();
  await t.ctl("cube-top").click();
  await page.waitForTimeout(600);
  await t.ctl("poly-draw").click();
  const verts = [[1.5, 11.5], [4.5, 11.5], [4.5, 14.8], [1.5, 14.8]];
  for (const [x, y] of verts) {
    const px = await settledScreen(page, [x, y, 0]);
    await page.mouse.click(px.x, px.y);
  }
  await page.keyboard.press("Enter");
  const rows = finiteRows();
  const wallRows = rows.filter((r) => inBox(r, [-1, 4.5, 2.5], [1, 10, 5]));
  const poly = rows.filter((r) => r[0] > 1.5 && r[0] < 4.5 && r[1] > 11.5 && r[1] < 14.8);
  const union = new Set([...wallRows, ...poly].map(rowId)).size;
  await t.previewIs(union);
  await t.exact("Selected", String(ROOM.wall));
  await expect.poll(async () => (await t.layer()).add).toBe(union - ROOM.wall);
  await t.ctl("sel-commit").click();
  await t.exact("Selected", String(union));
  await expect(t.note).toBeHidden();
});

const clusterAdd = async (page: import("@playwright/test").Page, radius: number) => {
  const t = previewHelpers(page);
  await openRoom(page, t.exact);
  await t.ctl("tool-cluster").click();
  await t.setNum("cluster-radius", 1.1);
  await t.pickSeed(CL.wall);
  await t.exact("Selected", String(ROOM.wall));
  await t.ctl("op-add").click();
  await t.setNum("cluster-radius", radius);
  return t;
};

test("E2E-83 12b Cluster Add: the preview is |A union B| before Commit draft, a radius edit re-previews, commit equals it and Apply deletes exactly that set", async ({ page }, testInfo) => {
  const rows = finiteRows();
  const wall = new Set(rows.filter(inWall).map(rowId));
  const truth = (radius: number) => new Set([...wall, ...clusterTruth(rows, [10, 10, 0], radius)]).size;
  const t = await clusterAdd(page, 0.6);
  await t.pickSeed(CL.floor);
  await t.previewIs(truth(0.6));
  await t.exact("Selected", String(ROOM.wall));
  const before = t.posts.preview;
  await t.setNum("cluster-radius", 1.1);
  expect(truth(1.1)).not.toBe(truth(0.6));
  await t.previewIs(truth(1.1));
  expect(t.posts.preview - before).toBeGreaterThanOrEqual(1);
  expect(t.posts.preview - before).toBeLessThanOrEqual(2);
  await t.exact("Selected", String(ROOM.wall));
  await expect.poll(async () => (await t.layer()).add).toBe(truth(1.1) - ROOM.wall);
  await t.ctl("sel-commit").click();
  await t.exact("Selected", String(truth(1.1)));
  await t.exact("Candidates", String(truth(1.1)));
  await t.ctl("apply").click();
  await t.exact("Active", String(ROOM_TOTAL - truth(1.1)));
  expect(t.confirms[0]).toContain(`${truth(1.1)} of ${ROOM_TOTAL} points`);
  const gone = new Set([...wall, ...clusterTruth(rows, [10, 10, 0], 1.1)]);
  await t.expectActive(testInfo, (r) => gone.has(rowId(r)));
});

test("E2E-84 12b Apply before commit deletes only the committed selection, not the previewed points; Undo restores", async ({ page }) => {
  const t = previewHelpers(page);
  await t.wallSelected();
  await t.ctl("op-add").click();
  await t.setBox(GHOST_BOX.c, GHOST_BOX.d);
  await t.previewIs(ROOM.wall + ROOM.ghost);
  await expect(t.ctl("apply")).toBeEnabled(); // owner ruling A
  await expect(t.ctl("apply")).toHaveAttribute("title", /only the 40 committed/);
  await t.ctl("apply").click();
  await t.exact("Active", String(ROOM_TOTAL - ROOM.wall));
  await expect(t.note).toBeHidden(); // afterChange clears the draft (the preview was against the old cloud)
  await expect(t.legend("preview-add")).toHaveCount(0);
  await expect.poll(async () => (await t.layer()).add).toBe(0);
  await t.ctl("undo").click();
  await t.exact("Active", String(ROOM_TOTAL));
});

test("E2E-85 12b Esc and Discard draft drop the preview and change nothing else; Replace still goes live with no draft", async ({ page }) => {
  const t = previewHelpers(page);
  await t.wallSelected();
  await expect(t.ctl("sel-discard")).toBeDisabled();
  await t.ctl("op-add").click();
  await t.setBox(GHOST_BOX.c, GHOST_BOX.d);
  await t.previewIs(ROOM.wall + ROOM.ghost);
  await expect(t.ctl("sel-discard")).toBeEnabled();
  await page.locator("#viewport").hover();
  await page.keyboard.press("Escape");
  await expect(t.note).toBeHidden();
  await expect(t.legend("preview-add")).toHaveCount(0);
  await expect(t.ctl("sel-discard")).toBeDisabled();
  await t.exact("Selected", String(ROOM.wall));
  await t.exact("Candidates", String(ROOM.wall));
  await expect.poll(async () => (await t.layer()).add).toBe(0);
  // again, dropped with the button
  await t.setBox([3, 13, 2], [3, 3, 1.5]); // only the z = 2 layer of the blob
  await t.previewIs(ROOM.wall + 9);
  await t.ctl("sel-discard").click();
  await expect(t.note).toBeHidden();
  await t.exact("Selected", String(ROOM.wall));
  // the first selection is live: after Clear selection one selection request, no draft note
  await t.ctl("sel-clear").click(); // also disarms the tool
  await t.exact("Selected", "0");
  await t.ctl("tool-box").click();
  const sel = t.posts.select;
  const prev = t.posts.preview;
  await t.setNum("box-size-z", 3);
  await t.exact("Selected", String(ROOM.ghost));
  expect(t.posts.select - sel).toBeGreaterThanOrEqual(1);
  expect(t.posts.preview).toBe(prev);
  await expect(t.note).toBeHidden();
});

test("E2E-86 12b Save with a pending draft stores the committed selection only; the reopened session has no draft", async ({ page }, testInfo) => {
  const t = previewHelpers(page);
  await t.wallSelected();
  await t.ctl("op-add").click();
  await t.setBox(GHOST_BOX.c, GHOST_BOX.d);
  await t.previewIs(ROOM.wall + ROOM.ghost);
  const [dl] = await Promise.all([page.waitForEvent("download"), t.ctl("save-session").click()]);
  const path = testInfo.outputPath("draft.pcdsession");
  await dl.saveAs(path);
  await page.locator("#file-input").setInputFiles({ name: "other.pcd", mimeType: "application/octet-stream", buffer: syntheticPcd() });
  await t.exact("Original", String(TOTAL));
  await page.locator("#file-input").setInputFiles({ name: "draft.pcdsession", mimeType: "application/octet-stream", buffer: readFileSync(path) });
  await t.exact("Original", String(ROOM_TOTAL));
  await t.exact("Selected", String(ROOM.wall));
  await expect(t.note).toBeHidden();
  await expect.poll(async () => (await t.layer()).id).toBeNull();
  await expect(t.legend("preview-add")).toHaveCount(0);
});

test("E2E-87 12b Cluster tuning: Radius and Exclude protected re-preview live (one request per pause), Commit draft commits the last preview, Cancel leaves the selection", async ({ page }) => {
  const rows = finiteRows();
  const wall = new Set(rows.filter(inWall).map(rowId));
  const prot = (r: number[]) => r[2] >= -0.1 && r[2] <= 0.1;
  const union = (radius: number, skip: (r: number[]) => boolean = () => false) => new Set([...wall, ...clusterTruth(rows, CL.blob as unknown as number[], radius, skip)]).size;
  const t = await clusterAdd(page, 0.4);
  await t.pickSeed(CL.blob);
  await t.previewIs(union(0.4));
  expect(union(0.4)).toBe(ROOM.wall + 1);
  for (const r of [1.05, 1.2]) {
    const before = t.posts.preview;
    await t.setNum("cluster-radius", r);
    await t.previewIs(union(r));
    expect(t.posts.preview - before).toBeLessThanOrEqual(2);
    await t.exact("Selected", String(ROOM.wall));
  }
  expect(union(1.05)).toBeGreaterThan(union(0.4));
  // Exclude protected: protect the floor slab, then the cluster may not walk through it
  await t.ctl("prot-enabled").check();
  await t.setNum("prot-min", -0.1);
  await t.setNum("prot-max", 0.1);
  await t.exact("Protected", String(ROOM.floor + ROOM.floorGhost));
  const excluded = await hook(page, (e) => (e.state() as unknown as { tools: { cluster: { excludeProtected: boolean } } }).tools.cluster.excludeProtected);
  await t.previewIs(union(1.2, excluded ? prot : () => false));
  const before = t.posts.preview;
  await t.ctl("cluster-exclude-protected").click();
  await t.previewIs(union(1.2, excluded ? () => false : prot));
  expect(t.posts.preview - before).toBeGreaterThanOrEqual(1);
  const last = union(1.2, excluded ? () => false : prot);
  await page.waitForTimeout(300);
  await page.screenshot({ path: "/out/preview-cluster-tuning.png" });
  await t.ctl("sel-commit").click();
  await t.exact("Selected", String(last));
  // Cancel during a slow preview: selection unchanged, app idle
  await t.ctl("op-subtract").click();
  await t.pickSeed(CL.blob); // 17: Commit draft cleared the seed; pick it again so the 0.4 edit has a cluster to preview
  await page.route("**/api/session/selection/preview", async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue().catch(() => undefined);
  });
  await t.setNum("cluster-radius", 0.4);
  await page.waitForTimeout(500);
  await t.ctl("cluster-cancel").click();
  await t.exact("Selected", String(last));
  await expect(page.locator("#progress")).toBeHidden();
});

// ---- the owner's report: Apply stayed disabled after one Cluster selection (E2E-88)
for (const immediate of [false, true]) {
  test(`E2E-88 a single Cluster selection ends with Apply enabled and deletes exactly the cluster${immediate ? ", with a Link distance edit right after the seed click" : ""}`, async ({ page }, testInfo) => {
    const t = clusterHelpers(page);
    await openRoom(page, t.exact);
    await t.ctl("tool-cluster").click();
    await t.setNum("cluster-radius", 1);
    await t.pickSeed(CL.wall);
    if (immediate) {
      await t.setNum("cluster-radius", 1.1); // no wait: the edit lands while the first selection is still being evaluated
    }
    await t.exact("Candidates", String(ROOM.wall));
    await expect(t.ctl("apply")).toBeEnabled();
    await t.ctl("apply").click();
    await t.exact("Active", String(ROOM_TOTAL - ROOM.wall));
    await t.expectActive(testInfo, inWall);
  });
}

test("E2E-88 an edit made while the first Cluster selection's state refresh is in flight (Add, then a Link distance edit) still leaves Apply enabled, and Apply deletes exactly the selection", async ({ page }, testInfo) => {
  const t = clusterHelpers(page);
  await openRoom(page, t.exact);
  await t.ctl("tool-cluster").click();
  await t.setNum("cluster-radius", 1);
  // fault injection, not a wait: hold the first render read that follows the selection POST (the state is read by then, so Selected has updated) until the edits are done
  let selected = false;
  let holding = false;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));
  let entered: () => void = () => undefined;
  const reached = new Promise<void>((r) => (entered = r));
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/session/selection")) selected = true;
  });
  await page.route("**/api/session/render**", async (route) => {
    if (selected && !holding && route.request().method() === "GET") {
      holding = true;
      entered();
      await gate;
    }
    await route.continue().catch(() => undefined);
  });
  await t.pickSeed(CL.wall);
  await reached; // the page knows the selection; its candidate is not set yet
  await t.ctl("op-add").click();
  await t.setNum("cluster-radius", 1.1); // a draft over the selection: previews only
  release();
  await t.exact("Candidates", String(ROOM.wall));
  await expect(t.ctl("apply")).toBeEnabled();
  await t.ctl("apply").click();
  await t.exact("Active", String(ROOM_TOTAL - ROOM.wall));
  await t.expectActive(testInfo, inWall);
});

// ---------------------------------------------------------------- part 16: Delete during a preview (E2E-130, E2E-131)
/** Holds every request whose method and path suffix match until `release()` (fault injection, not a wait). */
function holdRequests(page: Pg, method: string, suffix: string) {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));
  let entered: () => void = () => undefined;
  const reached = new Promise<void>((r) => (entered = r));
  let holding = true;
  void page.route(`**${suffix}`, async (route) => {
    if (holding && route.request().method() === method) {
      entered();
      await gate;
    }
    await route.continue().catch(() => undefined);
  });
  return {
    reached,
    release: () => {
      holding = false;
      release();
    },
  };
}

test("E2E-130 Delete works while a preview job is computing: it deletes the committed wall only and the late preview is ignored", async ({ page }, testInfo) => {
  const t = previewHelpers(page);
  await t.wallSelected();
  await t.ctl("op-add").click();
  const held = holdRequests(page, "POST", "/selection/preview");
  await t.setBox(GHOST_BOX.c, GHOST_BOX.d);
  await held.reached; // the preview job is busy and its request is held
  await expect(t.note).toContainText("Computing preview"); // a draft is showing
  await expect(t.ctl("apply")).toBeEnabled();
  await t.ctl("apply").click();
  await t.exact("Active", String(ROOM_TOTAL - ROOM.wall));
  await expect(t.note).toBeHidden();
  held.release();
  await t.exact("Active", String(ROOM_TOTAL - ROOM.wall));
  await expect(t.note).toBeHidden();
  await expect.poll(async () => (await t.layer()).add).toBe(0);
  await t.expectActive(testInfo, inWall);
});

test("E2E-131 an edit made while Commit draft's result is on its way does not strand Delete: Candidates equals Selected and Delete removes the union", async ({ page }, testInfo) => {
  const t = previewHelpers(page);
  await t.wallSelected();
  await t.ctl("op-add").click();
  await t.setBox(GHOST_BOX.c, GHOST_BOX.d);
  await t.previewIs(ROOM.wall + ROOM.ghost);
  // hold the poll of the commit job: the server has installed the selection, the page has not heard yet
  let committed = false;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/selection/commit")) committed = true;
  });
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));
  let entered: () => void = () => undefined;
  const reached = new Promise<void>((r) => (entered = r));
  let holding = true;
  await page.route("**/api/jobs/**", async (route) => {
    if (holding && committed && route.request().method() === "GET") {
      holding = false;
      entered();
      await gate;
    }
    await route.continue().catch(() => undefined);
  });
  await t.ctl("sel-commit").click();
  await reached;
  await t.setNum("box-size-x", GHOST_BOX.d[0]); // a shape edit while the commit is on the wire
  release();
  await t.exact("Selected", String(ROOM.wall + ROOM.ghost));
  await t.exact("Candidates", String(ROOM.wall + ROOM.ghost));
  await expect(t.ctl("apply")).toBeEnabled();
  await t.ctl("apply").click();
  await t.exact("Active", String(ROOM_TOTAL - ROOM.wall - ROOM.ghost));
  await t.expectActive(testInfo, (r) => inWall(r) || inBox(r, GHOST_BOX.c, GHOST_BOX.d));
});

// ---------------------------------------------------------------- part 13: tool flow (E2E-110..123)
/** Idle on three samples 150 ms apart: no job and no render under way (a gesture during a job is ignored by design). */
const appIdle = async (page: Pg) => {
  let ok = 0;
  for (let i = 0; i < 100 && ok < 3; i++) {
    const busy = await page.evaluate(() => {
      const s = (window as unknown as { __editor: { state: () => { job: { busy: boolean }; rendering: boolean } } }).__editor.state();
      return s.job.busy || s.rendering;
    });
    ok = busy ? 0 : ok + 1;
    await page.waitForTimeout(150);
  }
  expect(ok).toBe(3);
};
type PolyView = { phase: string; editing: boolean; vertices: number[][]; z: number };
const polyOf = (page: Pg) =>
  page.evaluate(() => {
    const s = (window as unknown as { __editor: { state: () => { tools: { polygon: { phase: string; editing: boolean; vertices: number[][] } }; camera: { target: number[] } } } }).__editor.state();
    return { phase: s.tools.polygon.phase, editing: s.tools.polygon.editing, vertices: s.tools.polygon.vertices.map((v) => [v[0], v[1]]), z: s.camera.target[2] };
  }) as Promise<PolyView>;
const cameraOf = (page: Pg) =>
  page.evaluate(() => {
    const c = (window as unknown as { __editor: { state: () => { camera: { target: number[]; orientation: number[]; distance: number } } } }).__editor.state().camera;
    return { target: [...c.target], orientation: [...c.orientation], distance: c.distance };
  });
const entriesOf = (page: Pg) =>
  page.evaluate(() => {
    const s = (window as unknown as { __editor: { state: () => { session: { history: { entries: { sid: number; shape: { type: string; seed_id?: number } | null; bounds: { min: number[]; max: number[] } | null }[] } } } } }).__editor.state();
    return s.session.history.entries.map((e) => ({ sid: e.sid, shape: e.shape, bounds: e.bounds }));
  });
/** Point in polygon (x, y; boundary cases do not occur with the room's integer grid and fractional vertices). */
const inPoly = (r: number[], poly: number[][]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > r[1] !== yj > r[1] && r[0] < ((xj - xi) * (r[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const inPolyCount = (poly: number[][]) => finiteRows().filter((r) => inPoly(r, poly)).length;
/** A box handle's page position once it has stopped moving (the view animates after a preset). */
const stableHandle = async (page: Pg, id: string) => {
  let prev: { x: number; y: number } | null = null;
  await expect
    .poll(async () => {
      const h = (await hook(page, (e) => e.handlePositions())).find((p) => p.id === id) ?? null;
      const same = !!prev && !!h && Math.hypot(h.x - prev.x, h.y - prev.y) < 0.5;
      prev = h;
      return same;
    }, { timeout: 5000, intervals: [100] })
    .toBe(true);
  return prev!;
};
/** A canvas spot that is not covered by a DOM overlay and is far from every box handle: a plain drag there orbits. */
const freeCanvasPoint = async (page: Pg) =>
  page.evaluate(() => {
    const cv = document.getElementById("viewport")!;
    const r = cv.getBoundingClientRect();
    const hs = (window as unknown as { __editor: { handlePositions: () => { x: number; y: number }[] } }).__editor.handlePositions();
    for (const fy of [0.3, 0.5, 0.7, 0.2, 0.8]) {
      for (const fx of [0.2, 0.35, 0.5, 0.65, 0.8]) {
        const p = { x: r.left + r.width * fx, y: r.top + r.height * fy };
        if (document.elementFromPoint(p.x, p.y) === cv && hs.every((h) => Math.hypot(h.x - p.x, h.y - p.y) > 90)) return p;
      }
    }
    return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.5 };
  });
const dragBetween = async (page: Pg, a: { x: number; y: number }, b: { x: number; y: number }) => {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
};

test("E2E-110 13 the first selection is live: real handle drags that shrink, grow and shrink the box leave exactly the last box's points, and no preview is asked for", async ({ page }) => {
  const t = previewHelpers(page);
  await openRoom(page, t.exact);
  await t.ctl("cube-top").click();
  await t.ctl("tool-box").click();
  await expect(page.locator("#live-note")).toContainText("First selection");
  for (const id of ["op-add", "op-subtract", "op-intersect"]) await expect(t.ctl(id)).toHaveAttribute("aria-checked", "false"); // none pressed
  await t.setBox(GHOST_BOX.c, GHOST_BOX.d);
  const rows = finiteRows();
  await t.exact("Selected", String(rows.filter((r) => inBox(r, GHOST_BOX.c, GHOST_BOX.d)).length));
  await appIdle(page);
  const seen: number[] = [];
  for (const metres of [-1, 2, -2]) {
    // the +X handle moves the right face; one metre on screen is measured from two projected points
    const centre = await settledScreen(page, [3, 13, 2]);
    const one = await settledScreen(page, [4, 13, 2]);
    const ppm = Math.hypot(one.x - centre.x, one.y - centre.y);
    const h = await stableHandle(page, "resize-0+");
    const u = { x: (h.x - centre.x) / Math.hypot(h.x - centre.x, h.y - centre.y), y: (h.y - centre.y) / Math.hypot(h.x - centre.x, h.y - centre.y) };
    await dragBetween(page, h, { x: h.x + u.x * ppm * metres, y: h.y + u.y * ppm * metres });
    const b = await t.box();
    const want = rows.filter((r) => inBox(r, b.c, b.d)).length;
    seen.push(want);
    await t.exact("Selected", String(want));
    await t.exact("Candidates", String(want));
    await appIdle(page);
  }
  expect(new Set(seen).size, `the three boxes select different counts (${seen})`).toBeGreaterThan(1); // a union would keep the largest
  expect(Math.min(...seen)).toBeLessThan(Math.max(...seen));
  expect(t.posts.preview).toBe(0);
  await expect(t.note).toBeHidden();
});

test("E2E-111 13 pressing the + icon ends the first selection: the next edit previews (Selected stays) and Commit draft changes Selected", async ({ page }) => {
  const t = previewHelpers(page);
  await t.wallSelected();
  await expect(page.locator("#live-note")).toBeVisible();
  const live0 = t.posts.select;
  await t.ctl("op-add").click();
  await expect(t.ctl("op-add")).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#live-note")).toBeHidden();
  await t.setBox(GHOST_BOX.c, GHOST_BOX.d);
  const rows = finiteRows();
  const union = new Set([...rows.filter((r) => inBox(r, [-1, 4.5, 2.5], [1, 10, 5])), ...rows.filter((r) => inBox(r, GHOST_BOX.c, GHOST_BOX.d))].map(rowId)).size;
  await t.previewIs(union);
  await t.exact("Selected", String(ROOM.wall));
  expect(t.posts.select).toBe(live0); // the edit asked for a preview, not a live selection
  expect(t.posts.preview).toBeGreaterThanOrEqual(1);
  await t.ctl("sel-commit").click();
  await t.exact("Selected", String(union));
  expect(t.posts.commit).toBe(1);
});

test("E2E-112 13 the operation icons are a radio group: real clicks and the arrow keys move the choice, Subtract and Intersect commit against the selection", async ({ page }) => {
  const t = previewHelpers(page);
  await t.wallSelected();
  const checked = async () => Promise.all(["op-add", "op-subtract", "op-intersect"].map((id) => t.ctl(id).getAttribute("aria-checked")));
  await t.ctl("op-subtract").click();
  expect(await checked()).toEqual(["false", "true", "false"]);
  await page.keyboard.press("ArrowRight");
  expect(await checked()).toEqual(["false", "false", "true"]);
  await expect(t.ctl("op-intersect")).toBeFocused();
  await page.keyboard.press("ArrowRight"); // wraps to Add
  expect(await checked()).toEqual(["true", "false", "false"]);
  await t.ctl("op-subtract").click();
  const rows = finiteRows();
  const c = [-1, 2.5, 2.5];
  const d = [1, 5, 5];
  await t.setBox(c, d);
  const wall = rows.filter((r) => inBox(r, [-1, 4.5, 2.5], [1, 10, 5]));
  const left = wall.filter((r) => !inBox(r, c, d)).length;
  await t.previewLeaves(left);
  await t.ctl("sel-commit").click();
  await t.exact("Selected", String(left));
  await t.ctl("op-intersect").click();
  await t.setBox([-1, 7.5, 2.5], [1, 5, 5]);
  const keep = wall.filter((r) => !inBox(r, c, d) && inBox(r, [-1, 7.5, 2.5], [1, 5, 5])).length;
  await t.previewLeaves(keep);
  await t.ctl("sel-commit").click();
  await t.exact("Selected", String(keep));
});

test("E2E-113 13 Cluster: pressing the tool waits for a seed, one click selects the cluster, Pick point clears the seed and waits, a second click picks another cluster", async ({ page }) => {
  const t = previewHelpers(page);
  await openRoom(page, t.exact);
  const rows = finiteRows();
  const pick = t.ctl("cluster-pick-seed");
  await t.ctl("tool-cluster").click();
  await expect(pick).toHaveAttribute("data-state", "waiting");
  await t.setNum("cluster-radius", 1);
  const at = async (w: readonly number[]) => {
    const p = await settledScreen(page, [...w]);
    await page.mouse.click(p.x, p.y);
  };
  await at(CL.wall);
  await expect(pick).toHaveAttribute("data-state", "set");
  await expect(page.locator("#inspector")).toContainText("Seed: point");
  await t.exact("Selected", String(clusterTruth(rows, [...CL.wall], 1).size));
  await pick.click();
  await expect(pick).toHaveAttribute("data-state", "waiting");
  await expect(page.locator("#inspector")).not.toContainText("Seed: point");
  await expect(t.ctl("tool-cluster")).toHaveClass(/active/); // the tool stays armed
  await at(CL.blob);
  await expect(pick).toHaveAttribute("data-state", "set");
  await t.exact("Selected", String(clusterTruth(rows, [...CL.blob], 1).size));
  await t.exact("Candidates", String(clusterTruth(rows, [...CL.blob], 1).size));
  // Esc leaves the waiting state paused; pressing Pick point waits again
  await pick.click();
  await expect(pick).toHaveAttribute("data-state", "waiting");
  await page.keyboard.press("Escape");
  await expect(pick).toHaveAttribute("data-state", "paused");
  await pick.click();
  await expect(pick).toHaveAttribute("data-state", "waiting");
});

test("E2E-114 13 Clear selection disarms the tool: no tool pressed, no seed, no polygon, and a drag orbits again", async ({ page }) => {
  const t = previewHelpers(page);
  await openRoom(page, t.exact);
  await t.ctl("tool-cluster").click();
  await t.setNum("cluster-radius", 1);
  const p = await settledScreen(page, [...CL.wall]);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator("#inspector")).toContainText("Seed: point");
  await t.exact("Selected", String(ROOM.wall));
  await t.ctl("sel-clear").click();
  await t.exact("Selected", "0");
  await expect(page.locator("#modebar")).toContainText("Tool: None");
  for (const id of ["tool-box", "tool-polygon", "tool-cluster", "tool-sparse"]) await expect(t.ctl(id)).not.toHaveClass(/active/);
  await expect(page.locator("#inspector")).not.toContainText("Seed: point");
  await appIdle(page);
  const before = await cameraOf(page);
  const free = await freeCanvasPoint(page);
  await dragBetween(page, free, { x: free.x + 100, y: free.y + 40 });
  expect((await cameraOf(page)).orientation).not.toEqual(before.orientation);
  // a half-drawn polygon goes too
  await t.ctl("tool-polygon").click();
  await t.ctl("poly-draw").click();
  await t.ctl("cube-top").click();
  const v = await settledScreen(page, [2, 12, 0]);
  await page.mouse.click(v.x, v.y);
  expect((await polyOf(page)).vertices.length).toBe(1);
  await t.ctl("sel-clear").click();
  const after = await polyOf(page);
  expect(after).toMatchObject({ phase: "idle", vertices: [] });
  await expect(page.locator("#modebar")).toContainText("Tool: None");
});

test("E2E-115 13 Polygon with the real mouse: draw, close, drag a vertex, then the pencil adds a vertex on an edge and removes one with Backspace and a double click; the selection follows each shape", async ({ page }) => {
  const t = previewHelpers(page);
  await openRoom(page, t.exact);
  await t.ctl("cube-top").click();
  await t.ctl("tool-polygon").click();
  await t.ctl("cube-top").click();
  await expect(t.ctl("poly-draw")).toHaveClass(/hint/); // the first step is highlighted until a polygon exists
  await expect(page.locator("#inspector")).toContainText("1 Press Draw polygon");
  await t.ctl("poly-draw").click();
  await expect(t.ctl("poly-draw")).not.toHaveClass(/hint/);
  for (const [x, y] of [[1.5, 11.5], [4.5, 11.5], [4.5, 14.8], [1.5, 14.8]]) {
    const px = await settledScreen(page, [x, y, 0]);
    await page.mouse.click(px.x, px.y);
  }
  await page.keyboard.press("Enter");
  let poly = await polyOf(page);
  expect(poly.phase).toBe("closed");
  await t.exact("Selected", String(inPolyCount(poly.vertices)));
  const world = (v: number[]) => settledScreen(page, [v[0], v[1], poly.z]);
  // drag the fourth vertex (1.5, 14.8) down to (1.5, 13.2) with the real mouse
  await appIdle(page);
  await dragBetween(page, await world(poly.vertices[3]), await world([1.5, 13.2]));
  poly = await polyOf(page);
  expect(poly.vertices[3][1]).toBeCloseTo(13.2, 0);
  expect(poly.vertices).toHaveLength(4);
  await t.exact("Selected", String(inPolyCount(poly.vertices)));
  // pencil: edit mode on, a click on the bottom edge adds a vertex, the shape (and the selection) stay
  await t.ctl("poly-edit").click();
  await expect(t.ctl("poly-edit")).toHaveAttribute("aria-pressed", "true");
  await appIdle(page);
  const mid = await world([(poly.vertices[0][0] + poly.vertices[1][0]) / 2, (poly.vertices[0][1] + poly.vertices[1][1]) / 2]);
  await page.mouse.click(mid.x, mid.y);
  poly = await polyOf(page);
  expect(poly.vertices).toHaveLength(5);
  expect(poly.vertices[1][1]).toBeCloseTo(11.5, 1);
  expect(poly.vertices[1][0]).toBeCloseTo(3, 1);
  await t.exact("Selected", String(inPolyCount(poly.vertices)));
  // drag the new vertex out; the selection grows by the points the move uncovers
  await appIdle(page);
  const grown = inPolyCount(poly.vertices);
  await dragBetween(page, await world(poly.vertices[1]), await world([3, 10.2]));
  poly = await polyOf(page);
  expect(poly.vertices[1][1]).toBeCloseTo(10.2, 0);
  await t.exact("Selected", String(inPolyCount(poly.vertices)));
  expect(inPolyCount(poly.vertices)).toBeGreaterThan(grown);
  // Backspace over the vertex removes it
  await appIdle(page);
  const at = await world(poly.vertices[1]);
  await page.mouse.move(at.x, at.y);
  await page.keyboard.press("Backspace");
  poly = await polyOf(page);
  expect(poly.vertices).toHaveLength(4);
  await t.exact("Selected", String(inPolyCount(poly.vertices)));
  // a double click on a vertex removes it too (down, up, down within the tap time)
  await appIdle(page);
  const second = await world(poly.vertices[2]);
  await page.mouse.dblclick(second.x, second.y);
  poly = await polyOf(page);
  expect(poly.vertices).toHaveLength(3);
  await t.exact("Selected", String(inPolyCount(poly.vertices)));
  // never below three: Backspace over a vertex of a triangle changes nothing
  const last = await world(poly.vertices[0]);
  await page.mouse.move(last.x, last.y);
  await page.keyboard.press("Backspace");
  expect((await polyOf(page)).vertices).toHaveLength(3);
  expect(t.posts.preview).toBe(0); // everything was the live first selection
  await page.keyboard.press("Escape");
  await expect(t.ctl("poly-edit")).toHaveAttribute("aria-pressed", "false");
  expect((await polyOf(page)).phase).toBe("closed"); // the shape stays
});

test("E2E-116 13 a click without movement moves the Box tool's box to the clicked point; a drag orbits and a handle drag still resizes", async ({ page }) => {
  const t = previewHelpers(page);
  await openRoom(page, t.exact);
  await t.ctl("cube-top").click();
  await t.ctl("tool-box").click();
  await appIdle(page);
  expect((await t.box()).d).toEqual([3, 3, 3]);
  const rows = finiteRows();
  const target = [14, 6, 0];
  const p = await settledScreen(page, target);
  await page.mouse.click(p.x, p.y);
  await expect.poll(async () => (await t.box()).c.map((v) => Math.round(v * 10) / 10)).toEqual([14, 6, 0]);
  const b = await t.box();
  expect(b.d).toEqual([3, 3, 3]);
  await t.exact("Candidates", String(rows.filter((r) => inBox(r, b.c, b.d)).length));
  await t.exact("Selected", String(rows.filter((r) => inBox(r, b.c, b.d)).length));
  // a drag across the cloud is an orbit, not a click: the box stays
  await appIdle(page);
  const cam = await cameraOf(page);
  const free = await freeCanvasPoint(page);
  await dragBetween(page, free, { x: free.x + 60, y: free.y + 40 });
  expect((await t.box()).c).toEqual(b.c);
  expect((await cameraOf(page)).orientation).not.toEqual(cam.orientation);
  // the handles still work
  await t.ctl("cube-top").click();
  await appIdle(page);
  const h = await stableHandle(page, "resize-0+");
  await dragBetween(page, h, { x: h.x + 40, y: h.y });
  expect((await t.box()).d[0]).toBeGreaterThan(3);
});

test("E2E-117 13 Live preview off: an Add edit asks for no preview, and Commit draft previews once and commits", async ({ page }) => {
  const t = previewHelpers(page);
  await t.wallSelected();
  await t.ctl("op-add").click();
  await t.ctl("preview-live").click();
  await expect(t.ctl("preview-live")).toHaveAttribute("aria-pressed", "false");
  const before = t.posts.preview;
  await t.setBox(GHOST_BOX.c, GHOST_BOX.d);
  await appIdle(page);
  expect(t.posts.preview).toBe(before); // moving the shape asked for nothing
  await t.exact("Selected", String(ROOM.wall));
  await expect(t.ctl("sel-commit")).toBeEnabled();
  const rows = finiteRows();
  const union = new Set([...rows.filter((r) => inBox(r, [-1, 4.5, 2.5], [1, 10, 5])), ...rows.filter((r) => inBox(r, GHOST_BOX.c, GHOST_BOX.d))].map(rowId)).size;
  await t.ctl("sel-commit").click();
  await t.exact("Selected", String(union));
  expect(t.posts.preview - before).toBe(1);
  expect(t.posts.commit).toBe(1);
  await t.ctl("preview-live").click(); // back on
  await expect(t.ctl("preview-live")).toHaveAttribute("aria-pressed", "true");
});

test("E2E-118 13 a step click centres the camera on that step, Edit shape reopens its box live without touching the history, and applying adds one new step that Undo removes", async ({ page }) => {
  const t = tl(page);
  await t.threeSteps();
  await appIdle(page);
  const before = await cameraOf(page);
  await t.card(0).locator(".step-icon").click();
  await expect.poll(async () => (await cameraOf(page)).target.map((v) => Math.round(v * 100) / 100)).toEqual([3, 13, 2]); // the blob step's bounds centre
  const after = await cameraOf(page);
  expect(after.orientation).toEqual(before.orientation); // framed, not turned
  const edit = t.ctl("step-edit-shape");
  await expect(edit).toBeVisible();
  await expect(edit).toBeEnabled();
  await expect(edit).toHaveAttribute("aria-label", "Edit the shape of step 1");
  const hist = await sidsOf(page);
  await edit.click();
  await expect(t.ctl("tool-box")).toHaveClass(/active/);
  for (const [id, v] of [["box-center-x", "3"], ["box-center-y", "13"], ["box-center-z", "2"], ["box-size-x", "4"], ["box-size-y", "4"], ["box-size-z", "3"]] as const) await expect(t.ctl(id)).toHaveValue(v);
  await expect(page.locator("#live-note")).toBeVisible(); // a live first selection
  await t.exact("Selected", "0"); // the blob is already deleted: nothing of it is left to select
  expect(await sidsOf(page)).toEqual(hist); // the history did not move
  await expect(t.cards).toHaveCount(3);
  // move the reopened box onto four floor points: applying adds a fourth step
  for (const [id, v] of [["box-center-x", 19], ["box-center-y", 19], ["box-center-z", 0], ["box-size-x", 2.2], ["box-size-y", 2.2], ["box-size-z", 1]] as const) await t.setNum(id, v);
  await t.exact("Candidates", "4");
  await t.ctl("apply").click();
  await expect(t.cards).toHaveCount(4);
  await t.exact("Active", String(ACTIVE_ALL - 4));
  await t.ctl("undo").click();
  await t.exact("Active", String(ACTIVE_ALL));
  await expect(t.cards).toHaveCount(4); // the new step is greyed (redo), the first three are untouched
  await expect(t.card(3)).toHaveClass(/greyed/);
  for (const i of [0, 1, 2]) await expect(t.card(i)).not.toHaveClass(/greyed/);
});

test("E2E-118b 13 Edit shape reopens a polygon step (closed, in edit mode) and a cluster step (seed id, link distance) from their stored shapes", async ({ page }) => {
  const t = tl(page);
  await t.open();
  await t.ctl("tool-cluster").click();
  await t.setNum("cluster-radius", 1.1);
  const seedAt = await settledScreen(page, [...CL.wall]);
  await page.mouse.click(seedAt.x, seedAt.y);
  await t.exact("Candidates", String(ROOM.wall));
  await t.ctl("apply").click();
  await expect(t.cards).toHaveCount(1);
  await t.ctl("tool-polygon").click();
  await t.ctl("cube-top").click();
  await t.ctl("poly-draw").click();
  for (const [x, y] of [[1.5, 11.5], [4.5, 11.5], [4.5, 14.8], [1.5, 14.8]]) {
    const px = await settledScreen(page, [x, y, 0]);
    await page.mouse.click(px.x, px.y);
  }
  await page.keyboard.press("Enter");
  const drawn = await polyOf(page);
  await t.exact("Selected", String(inPolyCount(drawn.vertices)));
  await appIdle(page);
  await t.ctl("apply").click();
  await expect(t.cards).toHaveCount(2);
  await appIdle(page);
  const entries = await entriesOf(page);
  expect(entries.map((e) => e.shape?.type)).toEqual(["cluster", "prism"]);
  // the polygon step
  await t.card(1).locator(".step-icon").click();
  await t.ctl("step-edit-shape").click();
  await expect(t.ctl("tool-polygon")).toHaveClass(/active/);
  await expect(t.ctl("poly-edit")).toHaveAttribute("aria-pressed", "true");
  const reopened = await polyOf(page);
  expect(reopened.phase).toBe("closed");
  expect(reopened.vertices).toEqual(drawn.vertices);
  // the cluster step
  await appIdle(page);
  await t.card(0).locator(".step-icon").click();
  await t.ctl("step-edit-shape").click();
  await expect(t.ctl("tool-cluster")).toHaveClass(/active/);
  await expect(t.ctl("cluster-pick-seed")).toHaveAttribute("data-state", "set");
  await expect(t.ctl("cluster-radius")).toHaveValue("1.1");
  const seed = await hook(page, (e) => (e.state() as unknown as { tools: { cluster: { seed: { id: number } | null } } }).tools.cluster.seed?.id ?? null);
  expect(seed).toBe(entries[0].shape?.seed_id);
  await expect(t.cards).toHaveCount(2); // still two steps
});

test("E2E-119 13 the stored shapes survive Save and reopen: the reopened step edits its box again and a step click centres the camera", async ({ page }, testInfo) => {
  const t = tl(page);
  await t.threeSteps();
  const [dl] = await Promise.all([page.waitForEvent("download"), t.ctl("save-session").click()]);
  const path = testInfo.outputPath("shapes.pcdsession");
  await dl.saveAs(path);
  const shapes = (await entriesOf(page)).map((e) => e.shape?.type ?? null);
  expect(shapes.slice(0, 2)).toEqual(["box", "cluster"]);
  await page.locator("#file-input").setInputFiles({ name: "other.pcd", mimeType: "application/octet-stream", buffer: syntheticPcd() });
  await t.exact("Active", String(TOTAL));
  await page.locator("#file-input").setInputFiles({ name: "shapes.pcdsession", mimeType: "application/octet-stream", buffer: readFileSync(path) });
  await t.exact("Original", String(ROOM_TOTAL));
  await expect(t.cards).toHaveCount(3);
  expect((await entriesOf(page)).map((e) => e.shape?.type ?? null)).toEqual(shapes);
  await appIdle(page);
  await t.card(0).locator(".step-icon").click();
  await expect.poll(async () => (await cameraOf(page)).target.map((v) => Math.round(v * 100) / 100)).toEqual([3, 13, 2]);
  await t.ctl("step-edit-shape").click();
  await expect(t.ctl("tool-box")).toHaveClass(/active/);
  for (const [id, v] of [["box-center-x", "3"], ["box-center-y", "13"], ["box-center-z", "2"], ["box-size-x", "4"], ["box-size-y", "4"], ["box-size-z", "3"]] as const) await expect(t.ctl(id)).toHaveValue(v);
  await expect(t.cards).toHaveCount(3);
});

test("E2E-120 13 Delete is a red button with readable text, and Select displayed and Invert refuse with the reason while a tool is armed", async ({ page }) => {
  const t = previewHelpers(page);
  await openRoom(page, t.exact);
  await expect(t.ctl("apply")).toContainText("Delete");
  const c = await t.ctl("apply").evaluate((e) => {
    const s = getComputedStyle(e);
    return { bg: s.backgroundColor, fg: s.color };
  });
  const rgb = (s: string) => (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  const lum = (v: number[]) => {
    const [r, g, b] = v.map((x) => { const u = x / 255; return u <= 0.03928 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [bg, fg] = [rgb(c.bg), rgb(c.fg)];
  expect(bg[0], `the Delete fill ${c.bg} is red`).toBeGreaterThan(bg[1] + 40);
  expect(bg[0]).toBeGreaterThan(bg[2] + 40);
  const [hi, lo] = [Math.max(lum(bg), lum(fg)), Math.min(lum(bg), lum(fg))];
  expect((hi + 0.05) / (lo + 0.05), `contrast of ${c.fg} on ${c.bg}`).toBeGreaterThanOrEqual(4.5);
  // no tool armed: Select displayed works
  await expect(t.ctl("sel-select-displayed")).toHaveAttribute("aria-disabled", "false");
  await t.ctl("tool-box").click();
  for (const id of ["sel-select-displayed", "sel-invert"]) {
    await expect(t.ctl(id)).toHaveAttribute("aria-disabled", "true");
    await expect(t.ctl(id)).toHaveAttribute("title", /Disarm the tool first/);
  }
  await appIdle(page);
  const selected = await t.num("Selected"); // the armed box made its own first selection
  await t.ctl("sel-select-displayed").click({ force: true }); // aria-disabled: Playwright would wait for it; a user can click it
  await expect(page.locator("#notices")).toContainText("Disarm the tool first");
  await t.exact("Selected", String(selected)); // the click changed nothing
  await t.ctl("sel-clear").click(); // disarms
  await expect(t.ctl("sel-select-displayed")).toHaveAttribute("aria-disabled", "false");
  await t.ctl("sel-select-displayed").click();
  await t.exact("Selected", String(ROOM_TOTAL - ROOM.invalid));
});

test("E2E-121 13 Sparse points selects only the floating artifacts of a dense floor and wall, and Delete removes exactly them", async ({ page }, testInfo) => {
  const t = clusterHelpers(page);
  await page.goto("/");
  await page.locator("#file-input").setInputFiles({ name: "sparse.pcd", mimeType: "application/octet-stream", buffer: sparseRoomPcd() });
  await t.exact("Original", SPARSE_TOTAL.toLocaleString("en-US"));
  await expect(t.ctl("tool-sparse")).toHaveText("Sparse points");
  await t.ctl("tool-sparse").click();
  await expect(t.ctl("tool-sparse")).toHaveClass(/active/);
  await expect(page.locator("#inspector")).toContainText("fewer than 8 points");
  await t.setNum("sparse-radius", 0.5);
  await t.exact("Selected", String(SPARSE.artifacts));
  await t.exact("Candidates", String(SPARSE.artifacts));
  // the radius left empty is derived from the point spacing and finds the same artifacts
  await t.ctl("sparse-radius").fill("");
  await t.ctl("sparse-radius").press("Tab");
  await t.exact("Selected", String(SPARSE.artifacts));
  // a count of 1 neighbour finds nothing: every point has itself
  await t.setNum("sparse-min", 1);
  await t.exact("Selected", "0");
  await t.setNum("sparse-min", 8);
  await t.exact("Selected", String(SPARSE.artifacts));
  await t.ctl("apply").click();
  await t.exact("Active", (SPARSE_TOTAL - SPARSE.artifacts).toLocaleString("en-US"));
  await t.ctl("export").click();
  const [dl] = await Promise.all([page.waitForEvent("download"), t.ctl("export-go").click()]);
  const path = testInfo.outputPath("sparse-cleaned.pcd");
  await dl.saveAs(path);
  const rows = parsePcd(readFileSync(path)).rows;
  const all = parsePcd(sparseRoomPcd()).rows;
  const kept = all.filter((r) => r[2] < 3).map(f32key).sort(); // independent truth: the artifacts are the points above z 3
  expect(rows.length).toBe(SPARSE.floor + SPARSE.wall);
  expect(rows.map(f32key).sort()).toEqual(kept);
});

for (const [w, hgt] of [[1280, 720], [1920, 1080]] as const) {
  test(`E2E-122 13 layout at ${w}x${hgt}: the operation icons fit one row, a highlighted step keeps its size with Edit shape inside it, and Sparse points fits the panel`, async ({ page }) => {
    test.setTimeout(240000);
    await page.setViewportSize({ width: w, height: hgt });
    const t = tl(page);
    await t.threeSteps();
    await appIdle(page);
    const opRow = await page.evaluate(() => {
      const g = document.querySelector('[data-control="op-select"]') as HTMLElement;
      const r = g.getBoundingClientRect();
      const kids = [...g.children].map((c) => c.getBoundingClientRect());
      const ins = document.getElementById("inspector")!;
      return { w: r.width, tops: kids.map((k) => Math.round(k.top)), scroll: [ins.scrollWidth, ins.clientWidth] };
    });
    expect(new Set(opRow.tops).size, "the three operation icons share one row").toBe(1);
    expect(opRow.scroll[0]).toBeLessThanOrEqual(opRow.scroll[1]);
    const plain = (await t.card(0).boundingBox())!;
    await t.card(0).locator(".step-icon").click();
    const edit = t.ctl("step-edit-shape");
    await expect(edit).toBeVisible();
    const card = (await t.card(0).boundingBox())!;
    const eb = (await edit.boundingBox())!;
    expect(card.height).toBeCloseTo(plain.height, 0); // the card keeps its size
    expect(card.width).toBeCloseTo(plain.width, 0);
    expect(eb.x).toBeGreaterThanOrEqual(card.x - 1);
    expect(eb.x + eb.width).toBeLessThanOrEqual(card.x + card.width + 1);
    expect(eb.y).toBeGreaterThanOrEqual(card.y - 1);
    expect(eb.y + eb.height).toBeLessThanOrEqual(card.y + card.height + 1);
    const over = await page.evaluate(() => {
      const rect = (e: Element) => e.getBoundingClientRect();
      const b = rect(document.querySelector('[data-control="step-edit-shape"]')!);
      const hits: string[] = [];
      for (const [name, sel] of [["legend", "#legend"], ["cube", "#viewcube .cube-stage"], ["cluster", "#camera-cluster"], ["triad", "#triad"], ["box", "#fbox-layer .fbox"]] as const) {
        for (const e of document.querySelectorAll(sel)) {
          const r = rect(e);
          if (r.width > 0 && r.height > 0 && b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top) hits.push(name);
        }
      }
      const doc = document.documentElement;
      return { hits, docScroll: [doc.scrollWidth - doc.clientWidth, doc.scrollHeight - doc.clientHeight] };
    });
    expect(over.hits).toEqual([]);
    expect(over.docScroll).toEqual([0, 0]);
    await t.ctl("tool-sparse").click();
    await expect(page.locator('[data-section="sparse"]')).toBeVisible();
    const fit = await page.evaluate(() => {
      const p = document.getElementById("editpanels")!;
      const s = document.querySelector('[data-section="sparse"]')!.getBoundingClientRect();
      const box = p.getBoundingClientRect();
      return { scroll: [p.scrollWidth, p.clientWidth], inside: s.left >= box.left - 1 && s.right <= box.right + 1 };
    });
    expect(fit.scroll[0]).toBeLessThanOrEqual(fit.scroll[1] + 1);
    expect(fit.inside).toBe(true);
    await page.screenshot({ path: `/out/part13-layout-${w}.png` });
  });
}

test("E2E-123 13 keyboard only: the operation icons toggle with Space and arrow keys, and the polygon pencil toggles with Enter and leaves with Esc", async ({ page }) => {
  const t = previewHelpers(page);
  await openRoom(page, t.exact);
  await t.ctl("tool-box").click();
  await t.ctl("op-add").focus();
  await page.keyboard.press("Space");
  await expect(t.ctl("op-add")).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("ArrowRight");
  await expect(t.ctl("op-subtract")).toHaveAttribute("aria-checked", "true");
  await expect(t.ctl("op-subtract")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(t.ctl("op-add")).toHaveAttribute("aria-checked", "true");
  await t.ctl("sel-clear").click();
  await t.ctl("tool-polygon").click();
  await t.ctl("cube-top").click();
  await t.ctl("poly-draw").click();
  for (const [x, y] of [[1.5, 11.5], [4.5, 11.5], [4.5, 14.8]]) {
    const px = await settledScreen(page, [x, y, 0]);
    await page.mouse.click(px.x, px.y);
  }
  await page.keyboard.press("Enter");
  expect((await polyOf(page)).phase).toBe("closed");
  await expect(t.ctl("poly-edit")).toBeEnabled();
  await t.ctl("poly-edit").focus();
  await page.keyboard.press("Enter"); // the focused pencil toggles itself; the key does not also leave the mode
  await expect(t.ctl("poly-edit")).toHaveAttribute("aria-pressed", "true");
  expect((await polyOf(page)).editing).toBe(true);
  await page.keyboard.press("Escape");
  await expect(t.ctl("poly-edit")).toHaveAttribute("aria-pressed", "false");
  expect((await polyOf(page)).editing).toBe(false);
  expect((await polyOf(page)).phase).toBe("closed");
  // the per-vertex remove buttons are reachable by keyboard in edit mode
  await t.ctl("poly-edit").focus();
  await page.keyboard.press("Space");
  const remove = page.locator("[data-vertex-remove]");
  await expect(remove).toHaveCount(3);
  await remove.first().focus();
  await page.keyboard.press("Enter");
  expect((await polyOf(page)).vertices).toHaveLength(3); // a triangle keeps its three vertices
});

const RGB_OF = { orange: [255, 159, 28], magenta: [255, 0, 255], white: [255, 255, 255], lime: [57, 255, 20] } as const;
/** Counts the viewport pixels within a small RGB distance of a colour (decodes a real screenshot in the page). */
async function pixelsNear(page: import("@playwright/test").Page, rgb: readonly number[]): Promise<number> {
  const png = (await page.locator("#viewport").screenshot()).toString("base64");
  return page.evaluate(
    async ([b64, target]) => {
      const bin = atob(b64);
      const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
      const img = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const c = new OffscreenCanvas(img.width, img.height);
      const g = c.getContext("2d")!;
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, img.width, img.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (Math.hypot(d[i] - target[0], d[i + 1] - target[1], d[i + 2] - target[2]) < 24) n++;
      return n;
    },
    [png, rgb] as [string, readonly number[]],
  );
}
async function selectWholeRoom(page: import("@playwright/test").Page, t: ReturnType<typeof helpers>) {
  await t.ctl("tool-box").click();
  for (const [id, v] of [["box-center-x", 9], ["box-center-y", 9], ["box-center-z", 2], ["box-size-x", 30], ["box-size-y", 30], ["box-size-z", 10]] as const) await t.setNum(id, v);
  await t.exact("Selected", String(ROOM_TOTAL - ROOM.invalid));
  await page.waitForTimeout(500);
}

for (const [w, hgt] of [[1280, 720], [1920, 1080]] as const) {
  test(`E2E-155 17 the focused Scope select and the selected-colour swatches keep their focus outlines apart at ${w}x${hgt}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: hgt });
    const t = helpers(page);
    await openRoom(page, t.exact);
    await t.ctl("preview-live").focus();
    await page.keyboard.press("Tab");
    await expect(t.ctl("scope-select")).toBeFocused();
    const r = await page.evaluate(() => {
      const grow = (el: Element) => {
        const b = el.getBoundingClientRect();
        return { l: b.left - 3, t: b.top - 3, r: b.right + 3, b: b.bottom + 3 };
      };
      const sel = grow(document.querySelector('[data-control="scope-select"]')!);
      const sw = [...document.querySelectorAll('[data-control="sel-colour"] [data-control^="sel-colour-"]')].map(grow);
      return { sel, sw };
    });
    expect(r.sw.length).toBeGreaterThan(0);
    for (const s of r.sw) {
      const overlap = s.l < r.sel.r && s.r > r.sel.l && s.t < r.sel.b && s.b > r.sel.t;
      expect(overlap, "a swatch outline touches the Scope select outline").toBe(false);
    }
  });
}

test("E2E-133 16-3 the selected colour: swatches by real mouse and keyboard recolour the canvas and the legend, survive colour modes, Save and reopen, and Clear selection", async ({ page }, testInfo) => {
  const t = helpers(page);
  const { ctl, exact } = t;
  await openRoom(page, exact);
  await ctl("cube-top").click();
  await selectWholeRoom(page, t);
  const legend = page.locator('#legend [data-legend="selected"]');
  await expect(legend).toHaveCSS("background-color", "rgb(255, 159, 28)");
  await expect(ctl("sel-colour-orange")).toHaveAttribute("aria-checked", "true");
  const orangeBefore = await pixelsNear(page, RGB_OF.orange); // selected points plus the orange box handles
  expect(orangeBefore).toBeGreaterThan(20);
  expect(await pixelsNear(page, RGB_OF.magenta)).toBe(0);
  // real mouse
  await ctl("sel-colour-magenta").click();
  await expect(legend).toHaveCSS("background-color", "rgb(255, 0, 255)");
  await expect(ctl("sel-colour-magenta")).toHaveAttribute("aria-checked", "true");
  await page.waitForTimeout(500);
  expect(await pixelsNear(page, RGB_OF.magenta)).toBeGreaterThan(20);
  expect(await pixelsNear(page, RGB_OF.orange)).toBeLessThan(orangeBefore - 20); // the points left orange (the handles stay)
  // keyboard: Tab from the Scope select lands on the checked swatch, Arrow moves and selects, Space selects
  await ctl("scope-select").focus();
  await page.keyboard.press("Tab");
  await expect(ctl("sel-colour-magenta")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(ctl("sel-colour-white")).toHaveAttribute("aria-checked", "true");
  await expect(legend).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Space");
  await expect(ctl("sel-colour-magenta")).toHaveAttribute("aria-checked", "true");
  await expect(legend).toHaveCSS("background-color", "rgb(255, 0, 255)");
  // the choice persists across colour modes
  for (const mode of ["viridis", "distance", "turbo"]) {
    await ctl("colour-mode").selectOption(mode);
    await page.waitForTimeout(500);
    await expect(legend).toHaveCSS("background-color", "rgb(255, 0, 255)");
    expect(await pixelsNear(page, RGB_OF.magenta), mode).toBeGreaterThan(20);
  }
  // Clear selection keeps the colour
  await ctl("sel-clear").click();
  await exact("Selected", "0");
  await expect(ctl("sel-colour-magenta")).toHaveAttribute("aria-checked", "true");
  // Save, replace by another file, reopen: swatch and legend are still magenta
  const [dl] = await Promise.all([page.waitForEvent("download"), ctl("save-session").click()]);
  const path = testInfo.outputPath("colour.pcdsession");
  await dl.saveAs(path);
  await page.locator("#file-input").setInputFiles({ name: "other.pcd", mimeType: "application/octet-stream", buffer: syntheticPcd() });
  await exact("Active", String(TOTAL));
  await expect(ctl("sel-colour-magenta")).toHaveAttribute("aria-checked", "true"); // a colour is a view setting: it stays across files
  await page.locator("#file-input").setInputFiles({ name: "colour.pcdsession", mimeType: "application/octet-stream", buffer: readFileSync(path) });
  await exact("Original", String(ROOM_TOTAL));
  await expect(ctl("sel-colour-magenta")).toHaveAttribute("aria-checked", "true");
  await expect(legend).toHaveCSS("background-color", "rgb(255, 0, 255)");
});

test("E2E-134 16-3 an Add preview keeps its own pink in the legend with a chosen selected colour; screenshots of 3 colour modes x 4 presets for the owner", async ({ page }) => {
  const t = helpers(page);
  const { ctl, exact, setNum } = t;
  await openRoom(page, exact);
  await ctl("cube-top").click();
  await selectWholeRoom(page, t);
  for (const mode of ["turbo", "viridis", "distance"]) {
    await ctl("colour-mode").selectOption(mode);
    for (const preset of ["orange", "magenta", "white", "lime"] as const) {
      await ctl(`sel-colour-${preset}`).click();
      await expect(page.locator('#legend [data-legend="selected"]')).toHaveCSS("background-color", `rgb(${RGB_OF[preset].join(", ")})`);
      await page.waitForTimeout(500);
      await page.screenshot({ path: `/out/selected-colour-${mode}-${preset}.png` });
    }
  }
  await ctl("colour-mode").selectOption("turbo");
  await ctl("sel-colour-magenta").click();
  // select the wall, press Add, move the box over the ghosts: the added points are previewed in the add colour
  await ctl("sel-clear").click();
  await ctl("tool-box").click();
  const setBox = async (c: number[], d: number[]) => {
    for (const [id, v] of [["box-center-x", c[0]], ["box-center-y", c[1]], ["box-center-z", c[2]], ["box-size-x", d[0]], ["box-size-y", d[1]], ["box-size-z", d[2]]] as const) await setNum(id, v);
  };
  await setBox([-1, 4.5, 2.5], [1, 10, 5]);
  await exact("Selected", String(ROOM.wall));
  await ctl("op-add").click();
  await setBox(GHOST_BOX.c, GHOST_BOX.d);
  await expect(page.locator('#legend [data-legend="preview-add"]')).toHaveCSS("background-color", "rgb(255, 79, 216)");
  await expect(page.locator('#legend [data-legend="selected"]')).toHaveCSS("background-color", "rgb(255, 0, 255)");
});

// ---------------------------------------------------------------- part 14: box gizmo (E2E-100..105)
type BoxMeasure = { coverage: number; outside: boolean; arrowTipsOnCanvas: number; arrowTips: number; body: boolean };
/** Measures the projected box against the canvas: share of the canvas the box hull covers, a free canvas pixel outside it, arrow tips on a canvas pixel. */
const measureBox = (page: Pg) =>
  page.evaluate((): BoxMeasure => {
    const ed = (window as unknown as { __editor: { state: () => { tools: { box: { center: number[]; dimensions: number[] } } }; projectWorld: (p: number[]) => { x: number; y: number } | null; handlePositions: () => { id: string; x: number; y: number }[]; boxBodyPoint: () => unknown } }).__editor;
    const cv = document.getElementById("viewport")!;
    const r = cv.getBoundingClientRect();
    const { center: c, dimensions: d } = ed.state().tools.box;
    const pts: { x: number; y: number }[] = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const p = ed.projectWorld([c[0] + (sx * d[0]) / 2, c[1] + (sy * d[1]) / 2, c[2] + (sz * d[2]) / 2]);
      if (p) pts.push(p);
    }
    // convex hull (monotone chain)
    const s = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const half = (list: { x: number; y: number }[]) => {
      const h: { x: number; y: number }[] = [];
      for (const p of list) {
        while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop();
        h.push(p);
      }
      h.pop();
      return h;
    };
    const hull = [...half(s), ...half([...s].reverse())];
    const inside = (x: number, y: number) => hull.length >= 3 && hull.every((a, i) => cross(a, hull[(i + 1) % hull.length], { x, y }) >= 0);
    let covered = 0;
    let free = 0;
    let n = 0;
    for (let i = 0; i < 40; i++) for (let j = 0; j < 40; j++) {
      const x = r.left + ((i + 0.5) / 40) * r.width;
      const y = r.top + ((j + 0.5) / 40) * r.height;
      n++;
      if (inside(x, y)) covered++;
      else if (document.elementFromPoint(x, y) === cv) free++;
    }
    const tips = ed.handlePositions().filter((h) => h.id.startsWith("resize-"));
    const onCanvas = tips.filter((h) => h.x >= r.left && h.x <= r.right && h.y >= r.top && h.y <= r.bottom && document.elementFromPoint(h.x, h.y) === cv).length;
    return { coverage: covered / n, outside: free > 0, arrowTipsOnCanvas: onCanvas, arrowTips: tips.length, body: ed.boxBodyPoint() !== null };
  });

for (const [w, hgt] of [[1280, 720], [1920, 1080]] as const) {
  test(`E2E-100 14 layout: how much of the canvas a fitted box covers, a plain drag can start outside it or on its body, and the six arrow tips are on canvas pixels, at ${w}x${hgt}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: w, height: hgt });
    const t = helpers(page);
    await openRoom(page, t.exact);
    await t.ctl("tool-box").click();
    await appIdle(page);
    const out: Record<string, BoxMeasure> = {};
    for (const [view, key] of [["cube-top", "1"], ["cube-front", "3"]] as const) {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press(key);
      await page.waitForTimeout(500);
      if (view === "cube-top") out[`${view} default`] = await measureBox(page);
      for (const fit of ["box-fit-cloud", "box-fit-displayed", "box-fit-view"] as const) {
        await t.ctl(fit).click();
        await page.waitForTimeout(500);
        out[`${view} ${fit}`] = await measureBox(page);
      }
    }
    console.log(`E2E-100 ${w}x${hgt} ${JSON.stringify(out)}`);
    testInfo.annotations.push({ type: "measure", description: JSON.stringify(out) });
    expect(Object.keys(out).length).toBe(7);
    // measured at 14-0 (coverage 0.005 default, 0.27..0.30 top and 0.0675..0.075 front when fitted; 1.0 for Fit to view)
    expect(out["cube-top default"].coverage).toBeGreaterThanOrEqual(0.004);
    expect(out["cube-top default"].outside).toBe(true);
    for (const k of ["cube-top box-fit-cloud", "cube-top box-fit-displayed", "cube-front box-fit-cloud", "cube-front box-fit-displayed"]) {
      expect(out[k].coverage).toBeGreaterThanOrEqual(0.05); // a body drag has something to grab
      expect(out[k].coverage).toBeLessThan(0.5); // and a plain drag can still start outside the box to orbit
      expect(out[k].outside).toBe(true);
      expect(out[k].body).toBe(true);
    }
    for (const k of Object.keys(out)) expect(out[k].arrowTipsOnCanvas).toBeGreaterThanOrEqual(k.endsWith("box-fit-view") ? 2 : 6);
    // Fit to view covers the whole canvas: there only Ctrl+drag (or the right/middle button) can orbit
    for (const v of ["cube-top", "cube-front"]) expect(out[`${v} box-fit-view`].outside).toBe(false);
  });
}

// ---- Part 14 real-mouse box gizmo tests
const rot3 = (rpy: number[]) => {
  const [r, p, y] = rpy.map((a) => (a * Math.PI) / 180);
  const [cr, sr, cp, sp, cy, sy] = [Math.cos(r), Math.sin(r), Math.cos(p), Math.sin(p), Math.cos(y), Math.sin(y)];
  return [
    [cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr],
    [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr],
    [-sp, cp * sr, cp * cr],
  ];
};
/** Independent oracle: |R^T (p - c)| <= d / 2 on every box axis, with the test's own Rz(yaw) Ry(pitch) Rx(roll). */
const inTurnedBox = (r: number[], c: number[], d: number[], rpy: number[]) => {
  const R = rot3(rpy);
  return [0, 1, 2].every((j) => Math.abs([0, 1, 2].reduce((a, i) => a + R[i][j] * (r[i] - c[i]), 0)) <= d[j] / 2 + 1e-9);
};
/** roll, pitch, yaw (degrees) of the app's box quaternion, from the test's own formulas. */
const rpyOf = (q: number[]) => {
  const [x, y, z, w] = q;
  const m20 = 2 * (x * z - w * y);
  const roll = Math.atan2(2 * (y * z + w * x), 1 - 2 * (x * x + y * y));
  const pitch = Math.asin(Math.max(-1, Math.min(1, -m20)));
  const yaw = Math.atan2(2 * (x * y + w * z), 1 - 2 * (y * y + z * z));
  return [roll, pitch, yaw].map((a) => (a * 180) / Math.PI);
};
const boxState = (page: Pg) => hook(page, (e) => ({ c: [...e.state().tools.box.center], d: [...e.state().tools.box.dimensions], q: [...e.state().tools.box.quat] }));
const bodyPoint = async (page: Pg) => {
  await expect.poll(() => hook(page, (e) => e.boxBodyPoint())).not.toBeNull();
  return (await hook(page, (e) => e.boxBodyPoint()))!;
};
/** Looks along a face by its key (a ViewCube face that turns away is not clickable). */
const lookFrom = async (page: Pg, preset: "top" | "front" | "right") => {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press({ top: "1", front: "3", right: "6" }[preset]);
  await page.waitForTimeout(500);
};
const gizmoBox = async (page: Pg, preset: string) => {
  const t = previewHelpers(page);
  await openRoom(page, t.exact);
  await t.ctl("tool-box").click();
  await lookFrom(page, preset);
  await t.setBox([10, 10, 0], [8, 8, 2]);
  await t.exact("Selected", String(finiteRows().filter((r) => inBox(r, [10, 10, 0], [8, 8, 2])).length));
  await appIdle(page);
  return t;
};

test("E2E-101 14 a real drag on a face arrow resizes only that dimension, the camera stays, and Selected equals the fixture count", async ({ page }) => {
  const t = await gizmoBox(page, "top");
  const cam = await cameraOf(page);
  const b0 = await boxState(page);
  const h = await stableHandle(page, "resize-0+");
  await dragBetween(page, h, { x: h.x + 50, y: h.y });
  const b = await boxState(page);
  expect(b.d[0]).toBeGreaterThan(b0.d[0] + 0.5);
  expect(b.d[1]).toBeCloseTo(b0.d[1], 9);
  expect(b.d[2]).toBeCloseTo(b0.d[2], 9);
  expect(b.c[1]).toBeCloseTo(b0.c[1], 9);
  expect(b.c[0] - b0.c[0]).toBeCloseTo((b.d[0] - b0.d[0]) / 2, 6); // the opposite face stayed
  expect(b.q.map((v, i) => Math.abs(v - b0.q[i])).every((v) => v < 1e-9)).toBe(true);
  expect(await cameraOf(page)).toEqual(cam);
  await t.exact("Selected", String(finiteRows().filter((r) => inBox(r, b.c, b.d)).length));
});

test("E2E-102 14 a real drag on the box body moves it (size and rotation unchanged), Shift pans, Ctrl orbits, and Selected equals the fixture count", async ({ page }) => {
  const t = await gizmoBox(page, "top");
  const b0 = await boxState(page);
  const cam0 = await cameraOf(page);
  const p = await bodyPoint(page);
  await dragBetween(page, p, { x: p.x + 40, y: p.y - 30 });
  const b = await boxState(page);
  expect(Math.hypot(b.c[0] - b0.c[0], b.c[1] - b0.c[1])).toBeGreaterThan(0.3);
  expect(b.c[2]).toBeCloseTo(b0.c[2], 6); // top view: the drag plane is horizontal
  expect(b.d).toEqual(b0.d);
  expect(b.q).toEqual(b0.q);
  expect(await cameraOf(page)).toEqual(cam0); // the camera did not move
  await t.exact("Selected", String(finiteRows().filter((r) => inBox(r, b.c, b.d)).length));
  // Ctrl+drag over the body orbits: the camera turns, the box stays
  const p2 = await bodyPoint(page);
  await page.keyboard.down("Control");
  await dragBetween(page, p2, { x: p2.x + 50, y: p2.y + 30 });
  await page.keyboard.up("Control");
  expect(await boxState(page)).toEqual(b);
  expect((await cameraOf(page)).orientation).not.toEqual(cam0.orientation);
  // Shift+drag over the body pans: the camera target moves, the box stays
  await lookFrom(page, "top");
  await appIdle(page);
  const cam1 = await cameraOf(page);
  const p3 = await bodyPoint(page);
  await page.keyboard.down("Shift");
  await dragBetween(page, p3, { x: p3.x + 40, y: p3.y + 20 });
  await page.keyboard.up("Shift");
  expect(await boxState(page)).toEqual(b);
  expect((await cameraOf(page)).target).not.toEqual(cam1.target);
});

test("E2E-103 14 three real ring drags (X, Y, then Z) give a box with roll, pitch and yaw all non-zero that selects what an independent rotation says, and Reset rotation levels it", async ({ page }) => {
  const t = await gizmoBox(page, "right");
  const ringDrag = async (i: number, preset: string) => {
    await lookFrom(page, preset);
    await appIdle(page);
    const a = await stableHandle(page, `rotate-${i}+`);
    const c = (await hook(page, (e) => e.boxRings())).find((r) => r.id === `rotate-${i}+`)!.centre!;
    const [vx, vy] = [a.x - c.x, a.y - c.y];
    const n = Math.hypot(vx, vy) || 1;
    // a 30 degree arc out to 5 ring radii from the ring centre (the ring is 8 px in radius)
    const [ux, uy] = [vx / n, vy / n];
    const [cs, sn] = [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)];
    await dragBetween(page, a, { x: c.x + (ux * cs - uy * sn) * 40, y: c.y + (ux * sn + uy * cs) * 40 });
  };
  await ringDrag(0, "right");
  const afterX = rpyOf((await boxState(page)).q);
  expect(Math.abs(afterX[0])).toBeGreaterThan(1);
  await ringDrag(1, "front");
  await ringDrag(2, "top");
  const b = await boxState(page);
  const rpy = rpyOf(b.q);
  for (const a of rpy) expect(Math.abs(a)).toBeGreaterThan(1);
  expect(b.c).toEqual([10, 10, 0]);
  expect(b.d).toEqual([8, 8, 2]);
  await t.exact("Selected", String(finiteRows().filter((r) => inTurnedBox(r, b.c, b.d, rpy)).length));
  await t.ctl("box-reset-rotation").click();
  const level = await boxState(page);
  expect(level.q.map((v, i) => Math.abs(v - [0, 0, 0, 1][i])).every((v) => v < 1e-9)).toBe(true);
  await t.exact("Selected", String(finiteRows().filter((r) => inBox(r, level.c, level.d)).length));
});

test("E2E-104 14 one keyboard sequence (nudge, grow, turn) edits the box and Selected equals the independent count", async ({ page }) => {
  const t = await gizmoBox(page, "top");
  await t.setNum("gizmo-step", 1);
  await t.setNum("gizmo-angle-step", 30);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("ArrowRight"); // +1 along X (top view: screen-right)
  await page.keyboard.press("Alt+ArrowUp"); // both faces of the box axis nearest screen-up grow by 1
  await page.keyboard.press("."); // yaw +30
  const b = await boxState(page);
  expect(b.c[0]).toBeCloseTo(11, 9);
  expect(b.c[1]).toBeCloseTo(10, 9);
  expect(b.d[0]).toBeCloseTo(8, 9);
  expect(b.d[1]).toBeCloseTo(10, 9);
  const rpy = rpyOf(b.q);
  expect(rpy[2]).toBeCloseTo(30, 6);
  expect(Math.abs(rpy[0]) + Math.abs(rpy[1])).toBeLessThan(1e-6);
  await t.exact("Selected", String(finiteRows().filter((r) => inTurnedBox(r, b.c, b.d, rpy)).length));
  // a key typed in a field never edits the box
  await t.ctl("box-center-x").focus();
  await page.keyboard.press("ArrowRight");
  expect((await boxState(page)).c[0]).toBeCloseTo(11, 9);
});

test("E2E-105 14 Esc during a body drag and during an arrow drag restores the box from before the drag", async ({ page }) => {
  const t = await gizmoBox(page, "top");
  const b0 = await boxState(page);
  const p = await bodyPoint(page);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 40, p.y + 20, { steps: 5 });
  await page.mouse.move(p.x + 80, p.y + 40, { steps: 5 });
  expect(Math.hypot(...(await boxState(page)).c.map((v, i) => v - b0.c[i]))).toBeGreaterThan(0.3);
  await page.keyboard.press("Escape");
  await page.mouse.move(p.x + 120, p.y + 60, { steps: 5 });
  await page.mouse.up();
  expect(await boxState(page)).toEqual(b0);
  const h = await stableHandle(page, "resize-0+");
  await page.mouse.move(h.x, h.y);
  await page.mouse.down();
  await page.mouse.move(h.x + 60, h.y, { steps: 6 });
  expect((await boxState(page)).d[0]).toBeGreaterThan(b0.d[0] + 0.5);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await boxState(page)).toEqual(b0);
  await t.exact("Selected", String(finiteRows().filter((r) => inBox(r, b0.c, b0.d)).length));
});

// ---- Part 14b real-mouse ring tests against an independent rotation oracle
type V3 = number[];
const q14Mul = (a: number[], b: number[]) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const q14Inv = (q: number[]) => [-q[0], -q[1], -q[2], q[3]];
const q14Rot = (q: number[], v: V3): V3 => {
  const t = q14Mul(q14Mul(q, [v[0], v[1], v[2], 0]), q14Inv(q));
  return [t[0], t[1], t[2]];
};
const v14Dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const v14Cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const v14Norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** ViewCube corner view: press 1 (top), then click the top-front-right corner; waits for the animated ortho camera to settle. */
const cornerView = async (page: Pg) => {
  await lookFrom(page, "top");
  await page.locator('[data-control="corner-top-front-right"]').click();
  let prev = "";
  await expect
    .poll(async () => {
      const cam = await hook(page, (e) => ({ o: e.state().camera.orientation, ortho: e.state().camera.ortho }));
      const key = JSON.stringify(cam);
      const same = key === prev;
      prev = key;
      return same;
    }, { timeout: 8000, intervals: [150] })
    .toBe(true);
  const cam = await cameraOf(page);
  const look = q14Rot(cam.orientation, [0, 0, -1]);
  const want = v14Norm([-1, 1, -1]);
  for (let i = 0; i < 3; i++) expect(look[i]).toBeCloseTo(want[i], 5);
  await appIdle(page);
};
/**
 * Turns the ring `id` by `deg` degrees with the real mouse and returns what an independent plane-angle oracle says the
 * box rotation should be (axis n, angle). The oracle maps the ring plane to the screen with the app's projectWorld.
 */
const ringTurn = async (page: Pg, id: string, deg: number) => {
  const b0 = await boxState(page);
  const i = Number(id[7]);
  const s = id[8] === "+" ? 1 : -1;
  const n = q14Rot(b0.q, [i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0]);
  const anchor = await stableHandle(page, id);
  const ring = (await hook(page, (e) => e.boxRings())).find((r) => r.id === id)!;
  // the ring centre lies on the arrow's shaft, outside the face
  const rel = ring.centreWorld.map((v, k) => v - b0.c[k]);
  expect(Math.hypot(...v14Cross(rel, n))).toBeLessThan(1e-9);
  expect(s * v14Dot(rel, n)).toBeGreaterThan(b0.d[i] / 2);
  const helper: V3 = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = v14Norm(v14Cross(helper, n));
  const w = v14Cross(n, u);
  const proj = (d: V3) => page.evaluate((c) => (window as unknown as { __editor: EditorHook }).__editor.projectWorld(c), ring.centreWorld.map((v, k) => v + d[k]));
  const S0 = (await proj([0, 0, 0]))!;
  const su = (await proj(u))!;
  const sw = (await proj(w))!;
  const A = [[su.x - S0.x, sw.x - S0.x], [su.y - S0.y, sw.y - S0.y]];
  const det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
  const toPlane = (p: { x: number; y: number }) => {
    const dx = p.x - S0.x;
    const dy = p.y - S0.y;
    return [(A[1][1] * dx - A[0][1] * dy) / det, (-A[1][0] * dx + A[0][0] * dy) / det];
  };
  const toScreen = (a: number, b: number) => ({ x: Math.round(S0.x + A[0][0] * a + A[0][1] * b), y: Math.round(S0.y + A[1][0] * a + A[1][1] * b) });
  const start = { x: Math.round(anchor.x), y: Math.round(anchor.y) };
  const p0 = toPlane(start);
  const r0 = Math.hypot(p0[0], p0[1]);
  const ang0 = Math.atan2(p0[1], p0[0]);
  const rad = (deg * Math.PI) / 180;
  const at = (k: number, scale: number) => toScreen((Math.cos(ang0 + k * rad) * r0 * scale), (Math.sin(ang0 + k * rad) * r0 * scale));
  const mid = at(0.5, 3);
  const end = at(1, 5);
  const pe = toPlane(end);
  const oracle = wrapPi(Math.atan2(pe[1], pe[0]) - Math.atan2(p0[1], p0[0]));
  await page.mouse.move(start.x, start.y);
  await expect.poll(async () => hook(page, (e) => (e.state() as unknown as { boxHover: string | null }).boxHover)).toBe(id);
  await page.mouse.down();
  await page.mouse.move(mid.x, mid.y, { steps: 4 });
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await page.mouse.up();
  await appIdle(page);
  return { n, oracle, b0, target: rad };
};
/** Rotation q_after * q_before^-1 as (axis component along n, perpendicular size, signed angle about n). */
const deltaAbout = (before: number[], after: number[], n: V3) => {
  let d = q14Mul(after, q14Inv(before));
  if (d[3] < 0) d = d.map((v) => -v);
  const v: V3 = [d[0], d[1], d[2]];
  return { perp: Math.hypot(...v14Cross(v, n)), angle: 2 * Math.atan2(v14Dot(v, n), d[3]) };
};

const RING_TURNS: [string, number][] = [["rotate-0+", 25], ["rotate-0-", -20], ["rotate-1+", 30], ["rotate-1-", -15], ["rotate-2+", 20], ["rotate-2-", -25]];

test("E2E-163 14b each of the six rings, dragged with the real mouse in the corner view, turns the box about that arrow's axis by exactly the angle an independent plane oracle gives", async ({ page }) => {
  const t = await gizmoBox(page, "top");
  await cornerView(page);
  for (const [id, deg] of RING_TURNS) {
    const r = await ringTurn(page, id, deg);
    const a = await boxState(page);
    const d = deltaAbout(r.b0.q, a.q, r.n);
    expect(d.perp, `${id} axis`).toBeLessThan(1e-9);
    expect(d.angle, `${id} angle`).toBeCloseTo(r.oracle, 6);
    expect(Math.sign(d.angle), `${id} sign`).toBe(Math.sign(r.target));
    expect(a.c, `${id} centre`).toEqual(r.b0.c);
    expect(a.d, `${id} dims`).toEqual(r.b0.d);
  }
  const b = await boxState(page);
  const rpy = rpyOf(b.q);
  await t.exact("Selected", String(finiteRows().filter((r) => inTurnedBox(r, b.c, b.d, rpy)).length));
  await t.ctl("box-reset-rotation").click();
  const level = await boxState(page);
  expect(level.q.map((v, i) => Math.abs(v - [0, 0, 0, 1][i])).every((v) => v < 1e-9)).toBe(true);
  await t.exact("Selected", String(finiteRows().filter((r) => inBox(r, level.c, level.d)).length));
});

test("E2E-164 14b in the corner view on a turned box the arrows still resize one dimension, the body still moves it, and Ctrl+drag on a ring orbits", async ({ page }) => {
  const t = await gizmoBox(page, "top");
  await cornerView(page);
  for (const id of ["rotate-0+", "rotate-1-", "rotate-2+"]) await ringTurn(page, id, 20);
  const resizeCheck = async (id: string) => {
    const i = Number(id[7]);
    const s = id[8] === "+" ? 1 : -1;
    const b0 = await boxState(page);
    const n = q14Rot(b0.q, [i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0]);
    const face = b0.c.map((v, k) => v + s * n[k] * (b0.d[i] / 2));
    const opp = b0.c.map((v, k) => v - s * n[k] * (b0.d[i] / 2));
    const h = await stableHandle(page, id);
    const f = (await page.evaluate((c) => (window as unknown as { __editor: EditorHook }).__editor.projectWorld(c), face))!;
    const len = Math.hypot(h.x - f.x, h.y - f.y);
    const to = { x: h.x + ((h.x - f.x) / len) * 40, y: h.y + ((h.y - f.y) / len) * 40 };
    await dragBetween(page, { x: Math.round(h.x), y: Math.round(h.y) }, { x: Math.round(to.x), y: Math.round(to.y) });
    await appIdle(page);
    const b = await boxState(page);
    for (let k = 0; k < 3; k++) {
      if (k === i) expect(b.d[k], id).toBeGreaterThan(b0.d[k] + 0.3);
      else expect(b.d[k], id).toBe(b0.d[k]);
    }
    expect(b.q, id).toEqual(b0.q);
    const opp1 = b.c.map((v, k) => v - s * n[k] * (b.d[i] / 2));
    for (let k = 0; k < 3; k++) expect(opp1[k], id).toBeCloseTo(opp[k], 9);
  };
  for (const id of ["resize-0+", "resize-1-", "resize-2+"]) await resizeCheck(id);
  // the body moves, size and rotation unchanged
  const b1 = await boxState(page);
  const p = await bodyPoint(page);
  await dragBetween(page, p, { x: p.x + 40, y: p.y - 30 });
  await appIdle(page);
  const b2 = await boxState(page);
  expect(Math.hypot(b2.c[0] - b1.c[0], b2.c[1] - b1.c[1], b2.c[2] - b1.c[2])).toBeGreaterThan(0.3);
  expect(b2.d).toEqual(b1.d);
  expect(b2.q).toEqual(b1.q);
  // Ctrl+drag starting on a ring orbits: the box is untouched, the camera turns
  const cam0 = await cameraOf(page);
  const a = await stableHandle(page, "rotate-2+");
  await page.keyboard.down("Control");
  await dragBetween(page, { x: Math.round(a.x), y: Math.round(a.y) }, { x: Math.round(a.x) + 60, y: Math.round(a.y) + 30 });
  await page.keyboard.up("Control");
  expect(await boxState(page)).toEqual(b2);
  expect((await cameraOf(page)).orientation).not.toEqual(cam0.orientation);
  await t.exact("Selected", String(finiteRows().filter((r) => inTurnedBox(r, b2.c, b2.d, rpyOf(b2.q))).length));
});

test("E2E-165 14b Esc in the middle of a ring drag restores the box from before the drag", async ({ page }) => {
  const t = await gizmoBox(page, "top");
  await cornerView(page);
  const b0 = await boxState(page);
  const sel0 = await t.num("Selected");
  const a = await stableHandle(page, "rotate-1+");
  const c = (await hook(page, (e) => e.boxRings())).find((r) => r.id === "rotate-1+")!.centre!;
  const [vx, vy] = [a.x - c.x, a.y - c.y];
  const n = Math.hypot(vx, vy);
  await page.mouse.move(Math.round(a.x), Math.round(a.y));
  await page.mouse.down();
  await page.mouse.move(Math.round(c.x - (vy / n) * 30 + (vx / n) * 10), Math.round(c.y + (vx / n) * 30 + (vy / n) * 10), { steps: 5 });
  await page.mouse.move(Math.round(c.x - (vy / n) * 50 + (vx / n) * 20), Math.round(c.y + (vx / n) * 50 + (vy / n) * 20), { steps: 5 });
  expect((await boxState(page)).q).not.toEqual(b0.q);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await boxState(page)).toEqual(b0);
  await appIdle(page);
  expect(await t.num("Selected")).toBe(sel0);
});

test("E2E-166 14b a box turned by three ring drags deletes exactly the oracle count and its history step stores the turned shape, which Edit shape reopens", async ({ page }) => {
  const t = await gizmoBox(page, "top");
  await cornerView(page);
  for (const [id, deg] of [["rotate-0+", 25], ["rotate-1+", 30], ["rotate-2-", -25]] as [string, number][]) await ringTurn(page, id, deg);
  const b = await boxState(page);
  const rpy = rpyOf(b.q);
  const n = finiteRows().filter((r) => inTurnedBox(r, b.c, b.d, rpy)).length;
  expect(n).toBeGreaterThan(0);
  await t.exact("Selected", String(n));
  const active0 = await t.num("Active");
  await t.ctl("apply").click();
  await t.exact("Active", String(active0 - n));
  await appIdle(page);
  const entries = await page.evaluate(() => (window as unknown as { __editor: { state: () => { session: { history: { entries: { shape: { center: number[]; dimensions: number[]; rpy_deg: number[] } | null }[] } } } } }).__editor.state().session.history.entries.map((e) => e.shape));
  const shape = entries[entries.length - 1]!;
  expect(shape.center).toEqual(b.c);
  expect(shape.dimensions).toEqual(b.d);
  shape.rpy_deg.forEach((v, k) => expect(Math.abs(v - rpy[k])).toBeLessThan(1e-9));
  await page.locator("#timeline .step[data-step]").last().locator(".step-icon").click();
  await t.ctl("step-edit-shape").click();
  await expect(t.ctl("tool-box")).toHaveClass(/active/);
  const re = await boxState(page);
  const sign = Math.sign(re.q.reduce((acc, v, k) => acc + v * b.q[k], 0)) || 1;
  re.q.forEach((v, k) => expect(Math.abs(sign * v - b.q[k])).toBeLessThan(1e-12));
  const rr = rpyOf(re.q);
  for (const [k, id] of ["box-roll", "box-pitch", "box-yaw"].entries()) expect(Math.abs(Number(await t.ctl(id).inputValue()) - rr[k])).toBeLessThan(0.01);
  await t.exact("Selected", "0");
});

// ---- part 15a: Hide selected (client-side, view only)
const FLOOR_BOX = { c: [9.5, 9.5, 0], d: [22, 22, 0.5] };
const hideHelpers = (page: import("@playwright/test").Page) => {
  const t = previewHelpers(page);
  const drawn = () => hook(page, (e) => e.drawnCount());
  const hideBtn = t.ctl("sel-hide");
  const chip = page.locator('[data-control="hidden-chip"]');
  /** Opens the room with the floor (and the nine floor ghosts) selected by a live Box, ready to hide. */
  const floorSelected = async () => {
    await openRoom(page, t.exact);
    await t.ctl("cube-top").click();
    await t.ctl("tool-box").click();
    await t.setBox(FLOOR_BOX.c, FLOOR_BOX.d);
    const n = finiteRows().filter((r) => inBox(r, FLOOR_BOX.c, FLOOR_BOX.d)).length;
    expect(n).toBe(ROOM.floor + ROOM.floorGhost);
    await t.exact("Selected", String(n));
    await t.exact("Candidates", String(n));
    return n;
  };
  return { ...t, drawn, hideBtn, chip, floorSelected };
};

test("E2E-90 15a Hide selected: the drawn count drops by exactly the hidden count, Select displayed and Invert run and leave the hidden points out, Apply asks nothing, the export still holds the hidden points, Show restores the draw, a reload still shows the hidden layer", async ({ page }, testInfo) => {
  const t = hideHelpers(page);
  const asked: string[] = [];
  page.on("dialog", (d) => asked.push(d.message()));
  const n = await t.floorSelected();
  const drawn0 = await t.drawn();
  await expect(t.hideBtn).toHaveText("Hide selected");
  await t.hideBtn.click();
  await expect.poll(t.drawn, { timeout: 15000 }).toBe(drawn0 - n);
  await t.exact("Selected", "0");
  await expect(t.hideBtn).toHaveText(`Show hidden (${n})`);
  await expect(t.hideBtn).toHaveAttribute("aria-pressed", "true");
  await expect(t.chip).toHaveText(`${n} hidden - Show`);
  await expect(t.ctl("tool-box")).toHaveClass(/active/); // hiding never disarms the tool
  // Select displayed and Invert are not refused: the server leaves the hidden floor out (disarm the tool first)
  await t.ctl("tool-box").click();
  const visible = finiteRows().length - n;
  await t.ctl("sel-select-displayed").click();
  await t.exact("Selected", String(visible));
  await t.ctl("sel-invert").click();
  await t.exact("Selected", "0");
  await t.ctl("tool-box").click(); // arm the Box tool again
  // box the ghost region and delete it: Apply asks nothing, the candidate already excludes hidden points
  await t.setBox(GHOST_BOX.c, GHOST_BOX.d);
  await t.exact("Selected", String(ROOM.ghost));
  await expect(t.ctl("apply")).toBeEnabled();
  await t.ctl("apply").click();
  await t.exact("Active", String(ROOM_TOTAL - ROOM.ghost));
  expect(asked).toEqual([]);
  // the export holds the whole active cloud, hidden floor included
  await t.ctl("export").click();
  await expect(page.locator("#export-hidden")).toHaveText(`${n} hidden points are exported too (hidden layers are exported unless unticked)`);
  const [dl] = await Promise.all([page.waitForEvent("download"), t.ctl("export-go").click()]);
  const path = testInfo.outputPath("hidden-export.pcd");
  await dl.saveAs(path);
  const expected = parsePcd(roomPcd()).rows.filter((r) => !inBox(r, GHOST_BOX.c, GHOST_BOX.d)).map(f32key).sort();
  const rows = parsePcd(readFileSync(path)).rows;
  expect(rows.length).toBe(expected.length);
  expect(rows.map(f32key).sort()).toEqual(expected);
  // Show restores the draw (minus the deleted ghosts)
  await t.hideBtn.click();
  await expect.poll(t.drawn, { timeout: 15000 }).toBe(drawn0 - ROOM.ghost);
  await expect(t.chip).toBeHidden();
  await expect(t.hideBtn).toHaveText("Hide selected");
  await t.exact("Selected", String(n)); // 17: Show hidden also reselects the points of the layer Hidden
  await t.ctl("sel-clear").click(); // Clear selection disarms the tool; the next box is a first (live) selection again
  await t.ctl("tool-box").click();
  // hide again (the wall joins the layer Hidden, which hides its floor again), reload: the server still hides them
  await t.setBox([-1, 4.5, 2.5], [1, 10, 5]);
  await t.exact("Selected", String(ROOM.wall));
  await t.hideBtn.click();
  await expect(t.chip).toBeVisible();
  await page.waitForTimeout(1600);
  await page.reload();
  await t.exact("Original", String(ROOM_TOTAL));
  await expect(t.chip).toBeVisible();
  await expect(t.chip).toHaveText(`${n + ROOM.wall} hidden - Show`);
  await expect(t.hideBtn).toHaveText(`Show hidden (${n + ROOM.wall})`);
  await expect.poll(t.drawn, { timeout: 15000 }).toBe(drawn0 - ROOM.ghost - n - ROOM.wall);
});

test("E2E-154 17 Show hidden also reselects the hidden points: the union with the selection, Candidates match, Delete works, the Box stays armed (button, then the legend chip)", async ({ page }) => {
  const t = hideHelpers(page);
  const asked: string[] = [];
  const n = await t.floorSelected();
  page.on("dialog", (d) => asked.push(d.message())); // after the open: the "unsaved edits" ask of a file left by an earlier test is not under test
  const drawn0 = await t.drawn();
  const WALL = { c: [-1, 4.5, 2.5], d: [1, 10, 5] };
  for (const via of ["button", "chip"] as const) {
    await t.hideBtn.click();
    await expect.poll(t.drawn, { timeout: 15000 }).toBe(drawn0 - n);
    await t.exact("Selected", "0");
    await t.setBox(WALL.c, WALL.d);
    await t.exact("Selected", String(ROOM.wall));
    await (via === "button" ? t.hideBtn : t.chip).click();
    await t.exact("Selected", String(n + ROOM.wall));
    await t.exact("Candidates", String(n + ROOM.wall));
    await expect(t.ctl("apply")).toBeEnabled();
    await expect(t.ctl("tool-box")).toHaveClass(/active/);
    await expect.poll(t.drawn, { timeout: 15000 }).toBe(drawn0);
    if (via === "button") {
      // start the second round from a clean slate: the floor is selected again by the live Box
      await t.ctl("sel-clear").click();
      await t.ctl("tool-box").click();
      await t.setBox(FLOOR_BOX.c, FLOOR_BOX.d);
      await t.exact("Selected", String(n));
    }
  }
  expect(asked).toEqual([]);
});

for (const [w, h] of [[1280, 720], [1920, 1080]] as const) {
  test(`E2E-90b 15a the Hide selected button and the chip never overlap the legend rows, the ViewCube, the camera cluster or the timeline, and the panel does not overflow at ${w}x${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    const t = hideHelpers(page);
    await t.floorSelected();
    await t.hideBtn.click();
    await expect(t.chip).toBeVisible();
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const box = (e: Element) => {
        const b = e.getBoundingClientRect();
        return { l: b.left, t: b.top, r: b.right, b: b.bottom };
      };
      const q = (s: string) => document.querySelector(s)!;
      return {
        chip: box(q('[data-control="hidden-chip"]')),
        legend: box(q("#legend")),
        head: box(q('[data-control="legend-menu"]')),
        rows: box(q("#legend-body")),
        btn: box(q('[data-control="sel-hide"]')),
        tools: box(q("#tools")),
        others: ["#viewcube", "#camera-cluster", "#timeline"].map((s) => ({ s, ...box(q(s)) })),
      };
    });
    const hit = (a: { l: number; t: number; r: number; b: number }, c: { l: number; t: number; r: number; b: number }) => a.l < c.r && c.l < a.r && a.t < c.b && c.t < a.b;
    expect(r.chip.l >= r.legend.l - 1 && r.chip.r <= r.legend.r + 1 && r.chip.t >= r.legend.t - 1 && r.chip.b <= r.legend.b + 1, "chip inside the legend box").toBe(true);
    expect(hit(r.chip, r.head), "chip x legend header").toBe(false);
    expect(hit(r.chip, r.rows), "chip x legend rows").toBe(false);
    for (const o of r.others) expect(hit(r.chip, o), `chip x ${o.s}`).toBe(false);
    expect(r.btn.l >= r.tools.l - 1 && r.btn.r <= r.tools.r + 1, "button inside the tools panel").toBe(true);
    await checkLayout(page, w, h);
  });
}

// ---- part 15b: named sub layers (E2E-140..146)
const layerHelpers = (page: Pg) => {
  const t = hideHelpers(page);
  const layers = () => hook(page, (e) => e.state().session!.layers.map((l: { id: number; name: string; visible: boolean; count: number }) => ({ id: l.id, name: l.name, visible: l.visible, count: l.count })));
  const eye = (id: number) => page.locator(`[data-layer-eye="${id}"]`);
  const edit = (id: number) => page.locator(`[data-layer-edit="${id}"]`);
  const more = (id: number) => page.locator(`[data-layer-more="${id}"]`);
  /** 17: Edit layer and To main sit in the row's details area; open it first. */
  const openMore = async (id: number) => {
    if ((await more(id).getAttribute("aria-expanded")) !== "true") await more(id).click();
  };
  const pick = (id: number) => page.locator(`[data-layer-row="${id}"]`);
  const newLayer = async (name: string) => {
    await page.locator('[data-control="layer-name"]').fill(name);
    await t.ctl("layer-new").click();
    await expect.poll(async () => (await layers()).some((l) => l.name === name), { timeout: 15000 }).toBe(true);
    return (await layers()).find((l) => l.name === name)!.id;
  };
  /** Opens the room, boxes the floor (and its ghosts) and makes the layer "Floor" from them. */
  const floorLayer = async () => {
    const n = await t.floorSelected();
    const id = await newLayer("Floor");
    await expect.poll(async () => (await layers()).find((l) => l.id === id)?.count, { timeout: 15000 }).toBe(n);
    return { id, n };
  };
  return { ...t, layers, eye, edit, more, openMore, pick, newLayer, floorLayer };
};
const wallSet = () => finiteRows().filter((r) => inBox(r, [0, 7.25, 2.5], [2, 5.5, 5]));

test("E2E-140 15b a layer made from the floor and hidden: the drawn count drops by exactly its count and the counts are unchanged", async ({ page }) => {
  const t = layerHelpers(page);
  const { id, n } = await t.floorLayer();
  const drawn0 = await t.drawn();
  await t.eye(id).click();
  await expect.poll(t.drawn, { timeout: 15000 }).toBe(drawn0 - n);
  await t.exact("Original", String(ROOM_TOTAL));
  await t.exact("Active", String(ROOM_TOTAL));
  await expect(t.chip).toHaveText(`${n} hidden - Show`);
  await t.eye(id).click();
  await expect.poll(t.drawn, { timeout: 15000 }).toBe(drawn0);
});

test("E2E-141 15b layers and their visibility survive Save and reopen; a file saved without layers reopens without layers", async ({ page }, testInfo) => {
  const t = layerHelpers(page);
  const { id, n } = await t.floorLayer();
  await t.eye(id).click();
  await expect.poll(async () => (await t.layers()).find((l) => l.id === id)?.visible, { timeout: 15000 }).toBe(false);
  const [dl] = await Promise.all([page.waitForEvent("download"), t.ctl("save-session").click()]);
  const path = testInfo.outputPath("layers.pcdsession");
  await dl.saveAs(path);
  await page.locator("#file-input").setInputFiles({ name: "other.pcd", mimeType: "application/octet-stream", buffer: syntheticPcd() });
  await t.exact("Active", String(TOTAL));
  expect(await t.layers()).toEqual([]);
  await page.locator("#file-input").setInputFiles({ name: "layers.pcdsession", mimeType: "application/octet-stream", buffer: readFileSync(path) });
  await t.exact("Original", String(ROOM_TOTAL));
  const back = await t.layers();
  expect(back).toHaveLength(1);
  expect(back[0]).toMatchObject({ name: "Floor", visible: false, count: n });
  // a layer-less save reopens layer-less
  await page.locator("#file-input").setInputFiles({ name: "other.pcd", mimeType: "application/octet-stream", buffer: syntheticPcd() });
  await t.exact("Active", String(TOTAL));
  const [dl2] = await Promise.all([page.waitForEvent("download"), t.ctl("save-session").click()]);
  const path2 = testInfo.outputPath("plain.pcdsession");
  await dl2.saveAs(path2);
  await page.locator("#file-input").setInputFiles({ name: "plain.pcdsession", mimeType: "application/octet-stream", buffer: readFileSync(path2) });
  await t.exact("Active", String(TOTAL));
  expect(await t.layers()).toEqual([]);
});

test("E2E-142 15b with the floor layer hidden, a ghost box with Apply deletes only the ghosts and asks nothing", async ({ page }) => {
  const t = layerHelpers(page);
  const asked: string[] = [];
  const { id } = await t.floorLayer();
  page.on("dialog", (d) => asked.push(d.message())); // after the open: the "unsaved edits" ask of an earlier test's file is not under test
  await t.eye(id).click();
  await expect.poll(async () => (await t.layers()).find((l) => l.id === id)?.visible, { timeout: 15000 }).toBe(false);
  await t.setBox(GHOST_BOX.c, GHOST_BOX.d);
  await t.exact("Selected", String(ROOM.ghost));
  await expect(t.ctl("apply")).toBeEnabled();
  await t.ctl("apply").click();
  await t.exact("Active", String(ROOM_TOTAL - ROOM.ghost));
  expect(asked).toEqual([]);
});

test("E2E-143 15b Edit layer: the box starts at the member bounds, a resized box with Set layer to selection makes the members equal the fixture truth, the released points are in main, and points taken from another layer are confirmed", async ({ page }) => {
  const t = layerHelpers(page);
  const asked: string[] = [];
  const { id, n } = await t.floorLayer();
  page.on("dialog", (d) => asked.push(d.message())); // after the open: the "unsaved edits" ask of a file left by an earlier test is not under test
  const main0 = await hook(page, (e) => e.state().session!.counts.main);
  await t.openMore(id);
  await expect(t.edit(id)).toHaveAttribute("aria-disabled", "false");
  await t.edit(id).click();
  await expect(t.ctl("layer-set")).toBeVisible();
  await expect(page.locator("#layer-editing")).toContainText("Editing layer Floor");
  await t.exact("Selected", String(n)); // the seeded box selects every member
  // shrink the box to the floor proper (the thin slab), leaving the floor ghosts out
  const FLOOR_ONLY = { c: [9.5, 9.5, 0], d: [22, 22, 0.02] };
  await t.setBox(FLOOR_ONLY.c, FLOOR_ONLY.d);
  const truth = finiteRows().filter((r) => inBox(r, FLOOR_ONLY.c, FLOOR_ONLY.d)).length;
  await t.exact("Selected", String(truth));
  await t.ctl("layer-set").click();
  await expect.poll(async () => (await t.layers()).find((l) => l.id === id)?.count, { timeout: 15000 }).toBe(truth);
  await expect(t.ctl("layer-set")).toBeHidden(); // edit mode ended
  await t.exact("Selected", String(truth)); // and the selection is kept
  expect(asked).toEqual([]);
  expect(await hook(page, (e) => e.state().session!.counts.main)).toBe(main0 + (n - truth)); // the released points went to main
  // the steal confirm: a second layer holds the wall, then the floor layer is set to a box over the wall
  await t.ctl("sel-clear").click();
  await t.ctl("tool-box").click();
  await t.setBox([-1, 4.5, 2.5], [1, 10, 5]);
  await t.exact("Selected", String(ROOM.wall));
  const wallId = await t.newLayer("Wall");
  await t.openMore(id);
  await t.edit(id).click();
  // Edit layer clears the selection (async) and then seeds the Box at the member bounds, overwriting the box fields: type only once edit mode is on
  await expect(t.ctl("layer-set")).toBeVisible();
  await expect(page.locator("#layer-editing")).toContainText("Editing layer Floor");
  await t.setBox([-1, 4.5, 2.5], [1, 10, 5]);
  await t.exact("Selected", String(ROOM.wall));
  await t.ctl("layer-set").click();
  await expect.poll(() => asked.length, { timeout: 15000 }).toBe(1);
  expect(asked[0]).toBe(`Move ${ROOM.wall} points out of other layers into Floor?`);
  await expect.poll(async () => (await t.layers()).find((l) => l.id === id)?.count, { timeout: 15000 }).toBe(ROOM.wall);
  expect((await t.layers()).find((l) => l.id === wallId)?.count ?? 0).toBe(0);
});

test("E2E-144 15b the export picker: unticking the floor exports the room minus the floor, a hidden ticked layer is in the file, the exact count is reported, and Export all restores the whole cloud", async ({ page }, testInfo) => {
  const t = layerHelpers(page);
  const { id, n } = await t.floorLayer();
  await t.eye(id).click();
  await expect.poll(async () => (await t.layers()).find((l) => l.id === id)?.visible, { timeout: 15000 }).toBe(false);
  const floorKeys = new Set(finiteRows().filter((r) => inBox(r, FLOOR_BOX.c, FLOOR_BOX.d)).map(f32key));
  const download = async (name: string) => {
    const [dl] = await Promise.all([page.waitForEvent("download"), t.ctl("export-go").click()]);
    const path = testInfo.outputPath(name);
    await dl.saveAs(path);
    return parsePcd(readFileSync(path)).rows.map(f32key).sort();
  };
  const all = parsePcd(roomPcd()).rows.map(f32key);
  // the hidden floor layer is ticked by default and is in the file
  await t.ctl("export").click();
  await expect(page.locator("#export-layers")).toContainText("(hidden, still exported)");
  expect(await download("all.pcd")).toEqual([...all].sort());
  // untick the floor layer
  await t.ctl("export").click();
  await page.locator(`[data-export-layer="${id}"]`).uncheck();
  await expect(page.locator("#export-summary")).toContainText(String(ROOM_TOTAL - n));
  const rest = await download("rest.pcd");
  expect(rest).toEqual(all.filter((k) => !floorKeys.has(k)).sort());
  expect(rest.length).toBe(ROOM_TOTAL - n);
  expect(rest.some((k) => floorKeys.has(k))).toBe(false);
  await expect(page.locator("#notices")).toContainText(`${ROOM_TOTAL - n} points exported`);
  // Export all ticks everything again
  await t.ctl("export").click();
  await page.locator(`[data-export-layer="${id}"]`).uncheck();
  await t.ctl("export-all").click();
  await expect(page.locator(`[data-export-layer="${id}"]`)).toBeChecked();
  expect((await download("again.pcd")).length).toBe(ROOM_TOTAL);
});

test("E2E-145 15b undoing a deletion puts the points back into their layer", async ({ page }) => {
  const t = layerHelpers(page);
  const { id, n } = await t.floorLayer();
  await t.ctl("apply").click();
  await t.exact("Active", String(ROOM_TOTAL - n));
  await expect.poll(async () => (await t.layers()).find((l) => l.id === id)?.count, { timeout: 15000 }).toBe(0);
  await t.ctl("undo").click();
  await t.exact("Active", String(ROOM_TOTAL));
  await expect.poll(async () => (await t.layers()).find((l) => l.id === id)?.count, { timeout: 15000 }).toBe(n);
});

// 17-10: the step-0 height of the Tools + Selection + Cloud content at HEAD 73870ad (room open, no tool, no layers)
const STEP0_TOOLS_CONTENT = 385.7;
for (const [w, h] of [[1280, 720], [1920, 1080]] as const) {
  test(`E2E-158 17 the left panel is compact at ${w}x${h}: Layers sits in it, rows are one line, nothing is covered`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    const t = layerHelpers(page);
    await t.floorSelected();
    await t.newLayer("L1");
    for (let i = 2; i <= 3; i++) {
      await t.ctl("sel-clear").click();
      await t.ctl("tool-box").click();
      await t.setBox([2 * i, 9.5, 0], [1.5, 22, 0.5]);
      await t.newLayer(`L${i}`);
    }
    await t.ctl("sel-clear").click();
    await t.exact("Selected", "0");
    await expect(page.locator("#layers-slot [data-section=layers]")).toBeVisible();
    const m = await page.evaluate(() => {
      const tools = document.getElementById("tools")!;
      const slot = document.getElementById("layers-slot")!;
      const kids = ([...tools.children] as HTMLElement[]).filter((k) => k.getBoundingClientRect().height > 0);
      const top = kids[0].getBoundingClientRect().top;
      const bottom = kids[kids.length - 1].getBoundingClientRect().bottom;
      const rows = [...document.querySelectorAll<HTMLElement>("#layer-list [data-layer-row]")].map((r) => r.getBoundingClientRect().height);
      return { kids: kids.map((k) => `${k.tagName}#${k.id}.${k.className}:${Math.round(k.getBoundingClientRect().top)}+${Math.round(k.getBoundingClientRect().height)}`), content: bottom - top - slot.getBoundingClientRect().height, scroll: [tools.scrollHeight, tools.clientHeight], rows };
    });
    expect(m.rows.length).toBe(4); // Main and three layers
    for (const rh of m.rows) expect(rh).toBeLessThanOrEqual(24);
    // height target pending owner ruling: the measured content height is logged, not asserted
    console.log(`LEFT-PANEL-CONTENT ${w}x${h} ${m.content.toFixed(1)} (step 0: ${STEP0_TOOLS_CONTENT})`);
    if (h >= 1080) expect(m.scroll[0]).toBeLessThanOrEqual(m.scroll[1]);
    // every control of the panel can be scrolled into view and is not covered
    const ids = await page.evaluate(() => [...document.querySelectorAll("#tools [data-control]")].map((e) => e.getAttribute("data-control")!));
    expect(ids.length).toBeGreaterThan(20);
    for (const id of ids) {
      const el = page.locator(`#tools [data-control="${id}"]`);
      if (!(await el.isVisible())) continue;
      await el.scrollIntoViewIfNeeded();
      const covered = await el.evaluate((e) => {
        const r = e.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !(hit === e || e.contains(hit));
      });
      expect(covered, `${id} is not covered`).toBe(false);
    }
  });
}

for (const [w, h] of [[1280, 720], [1920, 1080]] as const) {
  test(`E2E-146 15b eight layers at ${w}x${h}: the panel, the legend rows and the chip do not overlap the ViewCube, the camera cluster or the timeline`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    const t = layerHelpers(page);
    await t.floorSelected();
    await t.newLayer("L1");
    for (let i = 2; i <= 8; i++) {
      await t.ctl("sel-clear").click();
      await t.ctl("tool-box").click();
      await t.setBox([2 * i, 9.5, 0], [1.5, 22, 0.5]); // a strip of the floor: the points come out of L1 (the helpers accept the confirm)
      await t.newLayer(`L${i}`);
    }
    expect((await t.layers()).length).toBe(8);
    const first = (await t.layers())[0].id;
    await t.eye(first).click();
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
      const box = (e: Element) => {
        const b = e.getBoundingClientRect();
        return { l: b.left, t: b.top, r: b.right, b: b.bottom };
      };
      const q = (s: string) => document.querySelector(s)!;
      return {
        legend: box(q("#legend")),
        chip: box(q('[data-control="hidden-chip"]')),
        tools: box(q("#tools")),
        list: box(q("#layer-list")),
        others: ["#viewcube", "#camera-cluster", "#timeline"].map((s) => ({ s, ...box(q(s)) })),
      };
    });
    const hit = (a: { l: number; t: number; r: number; b: number }, c: { l: number; t: number; r: number; b: number }) => a.l < c.r && c.l < a.r && a.t < c.b && c.t < a.b;
    for (const o of r.others) {
      expect(hit(r.legend, o), `legend x ${o.s}`).toBe(false);
      expect(hit(r.chip, o), `chip x ${o.s}`).toBe(false);
    }
    expect(r.list.l >= r.tools.l - 1 && r.list.r <= r.tools.r + 1, `layer list inside the left panel ${JSON.stringify([r.list, r.tools])}`).toBe(true);
    await checkLayout(page, w, h);
  });
}

// 17-11: owner screenshots, idle and Cluster armed with a partial result, 3 layers; the only assertions are idle and no console errors
for (const [w, h] of [[1280, 720], [1920, 1080]] as const) {
  test(`E2E-160 17 owner screenshots at ${w}x${h}: idle and Cluster armed with 3 layers`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error" && !/404/.test(m.text())) errors.push(m.text());
    });
    const t = layerHelpers(page);
    await t.floorSelected();
    await t.newLayer("L1");
    for (let i = 2; i <= 3; i++) {
      await t.ctl("sel-clear").click();
      await t.ctl("tool-box").click();
      await t.setBox([2 * i, 9.5, 0], [1.5, 22, 0.5]);
      await t.newLayer(`L${i}`);
    }
    await t.ctl("sel-clear").click();
    await t.exact("Selected", "0");
    await page.waitForTimeout(500);
    await page.screenshot({ path: `/out/part17-${w}x${h}-idle.png` });
    await t.ctl("tool-cluster").click();
    await t.setNum("cluster-radius", 1.0);
    await t.ctl("cluster-max-points").fill("200");
    await t.ctl("cluster-max-points").press("Tab");
    await t.ctl("cluster-pick-seed").click();
    await page.waitForTimeout(200);
    const px = await page.evaluate((p) => (window as unknown as { __editor: EditorHook }).__editor.projectWorld(p as [number, number, number]), [...CL.floor]);
    expect(px).not.toBeNull();
    await page.mouse.click(px!.x, px!.y);
    await expect(page.locator("#inspector")).toContainText("Seed: point");
    await t.exact("Selected", "200");
    await expect(page.locator("#cluster-limit")).toContainText("Stopped at limit 200");
    await page.waitForTimeout(500);
    await page.screenshot({ path: `/out/part17-${w}x${h}-cluster-armed.png` });
    expect(errors).toEqual([]);
  });
}

// 17-11: the step-0 stage height at HEAD 73870ad (room open, no tool, no layers)
const STEP0_STAGE = { 720: 596.8, 1080: 956.8 } as const;
for (const [w, h] of [[1280, 720], [1920, 1080]] as const) {
  test(`E2E-159 17 the header rows are thinner at ${w}x${h}: one line each, every control inside its row, the stage is taller`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    const t = helpers(page);
    await openRoom(page, t.exact);
    const m = await page.evaluate(() => {
      const row = (id: string) => {
        const r = document.getElementById(id)!;
        const rb = r.getBoundingClientRect();
        const ctl = [...r.querySelectorAll<HTMLElement>("[data-control]")].map((e) => {
          const b = e.getBoundingClientRect();
          return { id: e.getAttribute("data-control")!, visible: b.width > 0 && b.height > 0, inside: b.top >= rb.top - 0.5 && b.bottom <= rb.bottom + 0.5 && b.left >= rb.left - 0.5 && b.right <= rb.right + 0.5 };
        });
        return { height: rb.height, ctl };
      };
      return { toolbar: row("toolbar"), viewbar: row("viewbar"), stage: document.getElementById("viewport")!.getBoundingClientRect().height };
    });
    expect(m.toolbar.height).toBeLessThanOrEqual(33);
    expect(m.viewbar.height).toBeLessThanOrEqual(29);
    for (const c of [...m.toolbar.ctl, ...m.viewbar.ctl]) {
      expect(c.visible, `${c.id} is visible`).toBe(true);
      expect(c.inside, `${c.id} is inside its row`).toBe(true);
    }
    expect(m.toolbar.ctl.length).toBeGreaterThan(5);
    expect(m.viewbar.ctl.length).toBeGreaterThan(3);
    expect(m.stage).toBeGreaterThan(STEP0_STAGE[h]);
  });
}
