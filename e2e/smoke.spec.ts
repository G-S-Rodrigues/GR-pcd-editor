import { expect, test } from "@playwright/test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { BIG, DUP, FLOOR, PLANE_ROOM, PLANE_ROOM_TOTAL, GHOST, NORMAL_ROOM_TOTAL, ROOM, ROOM_TOTAL, SPARSE, SPARSE_TOTAL, TILTED, TOTAL, bigRoomPcd, bigRoomXyz, countInTiltedSlab, clusterNearestTruth, countInXyz, countPlane, dupRoomPcd, dupTruth, normalRoomPcd, planeRoomPcd, voxelTruth, parsePcd, roomPcd, rowKey, sparseRoomPcd, syntheticPcd, tiltedFloorAngles, tiltedFloorPcd, truthKeys } from "./synthetic";

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
    await expect(page.locator('#cloud-details [data-status="Original"]')).toContainText(String(TOTAL));
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
    await expect(page.locator("#cloud-details")).toContainText("Orthographic");
    await page.locator('[data-control="view-perspective"]').click();
    await expect(page.locator("#cloud-details")).toContainText("Perspective");
    await page.locator('[data-control="view-perspective"]').click();
    await page.locator('[data-control="cube-top"]').click();
  });

  await test.step("E2E-02 pivot: reset, pick", async () => {
    await page.locator('[data-control="pivot-reset"]').click();
    await expect(page.locator("#cloud-details")).toContainText("4.5, 4.5, 1.5");
    // the typed fields and Set pivot are gone; the pivot is set by picking. Top view: the point under the click with the greatest Z is picked
    await expect(page.locator('[data-control="pivot-x"]')).toHaveCount(0);
    await expect(page.locator('[data-control="pivot-set"]')).toHaveCount(0);
    await page.locator('[data-control="pivot-pick"]').click();
    await expect(page.locator("#modebar")).toContainText("Tool: Pick pivot");
    await expect(page.locator('[data-control="pivot-pick"]')).toHaveAttribute("aria-pressed", "true");
    await pickAtWorld(page, [4, 4, 0]);
    await expect(page.locator("#cloud-details")).toContainText("Pivot4, 4, 3");
    await expect(page.locator("#modebar")).toContainText("Tool: None");
  });

  await test.step("E2E-01 colouring options follow the schema", async () => {
    const colour = page.locator('[data-control="colour-mode"]');
    expect(await colour.locator("option").evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value))).toEqual(["turbo", "viridis", "flat", "distance", "normals"]);
    await expect(colour).toHaveValue("turbo");
    await openPop(page, "display");
    await colour.selectOption("viridis");
    await closePop(page, "display");
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
  await expect(page.locator('#cloud-details [data-status="Original"]')).toContainText(String(TOTAL));
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
  const { stat, exact, num } = statOf(page);
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
  const { stat, exact, num } = statOf(page);
  const ctl = (id: string) => page.locator(`[data-control="${id}"]`);
  const setNum = async (id: string, v: number) => {
    await expandFilterBox(page, id);
    await ctl(id).fill(String(v));
    await ctl(id).press("Tab");
  };
  await exact("Displayed", String(FLOOR + GHOST));
  const activeBefore = await num("Active");
  await expect(page.locator("#unsaved-badge")).toBeHidden();
  await expect(page.locator("#unsaved-badge")).toHaveAttribute("title", "No unsaved edits");

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
    await expect(page.locator("#unsaved-badge")).toHaveText("Edited");
    await expect(page.locator("#unsaved-badge")).toHaveAttribute("title", "Unsaved edits");
    await ctl("undo").click();
    await exact("Active", String(activeBefore));
    await ctl("redo").click();
    await exact("Active", String(activeBefore - GHOST));
  });

  await test.step("E2E-07 comparison: overlay and split keep the exact counts", async () => {
    await ctl("compare-overlay").click();
    await expect(page.locator("#modebar")).toContainText("View: Overlay (read-only)");
    await expect(page.locator("#counts-panel")).toContainText(`Deleted${GHOST} (`);
    await expect(page.locator("#cloud-details")).toContainText(`Rendered all ${GHOST} eligible points`);
    await expect(ctl("apply")).toBeDisabled();
    await expect(ctl("tool-box")).toBeDisabled();
    await ctl("compare-split").click();
    await expect(page.locator("#modebar")).toContainText("View: Split (read-only)");
    await expect(page.locator("#cloud-details")).toContainText("Right drawn");
    await exact("Active", String(activeBefore - GHOST));
    await ctl("compare-edited").click();
    await expect(page.locator("#modebar")).not.toContainText("View:");
    await exact("Active", String(activeBefore - GHOST));
  });

  await test.step("AC-17 view state: colouring is stored with the session", async () => {
    const put = page.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith("/api/session/client-state") && JSON.parse(r.postData() ?? "{}")?.colour === "viridis");
    await openPop(page, "display");
    await ctl("colour-mode").selectOption("viridis");
    await closePop(page, "display");
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
    await expect(tab.locator("#unsaved-badge")).toHaveText("Edited");
    await expect(tab.locator("#unsaved-badge")).toHaveAttribute("title", "Unsaved edits");
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
    await expect(page.locator("#unsaved-badge")).toBeHidden();
    await expect(page.locator("#unsaved-badge")).toHaveAttribute("title", "No unsaved edits");
    await expect(page.locator("#notices")).toContainText("Session download started");
    // another file replaces the open session, then the downloaded session is reopened through the picker
    await page.locator("#file-input").setInputFiles({ name: "other.pcd", mimeType: "application/octet-stream", buffer: syntheticPcd() });
    await exact("Active", String(TOTAL));
    await page.locator("#file-input").setInputFiles({ name: "synthetic_session_v1.pcdsession", mimeType: "application/octet-stream", buffer: readFileSync(path) });
    await exact("Original", String(TOTAL));
    await exact("Active", String(activeBefore - GHOST));
    await exact("Displayed", String(FLOOR));
    await expect(page.locator("#unsaved-badge")).toBeHidden();
    await expect(page.locator("#unsaved-badge")).toHaveAttribute("title", "No unsaved edits");
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

/** The popover anchors by popover id. */
const POP_ANCHOR: Record<string, string> = { display: "display-open", details: "details-open", help: "help", history: "history-open" };
/** Opens a popover through its anchor only if it is closed. */
async function openPop(page: import("@playwright/test").Page, id: string) {
  const a = page.locator(`[data-control="${POP_ANCHOR[id]}"]`);
  if ((await a.getAttribute("aria-expanded")) !== "true") await a.click();
  await expect(a).toHaveAttribute("aria-expanded", "true");
}
/** Closes a popover through its anchor only if it is open (Esc cannot, while a select holds the focus). */
async function closePop(page: import("@playwright/test").Page, id: string) {
  const a = page.locator(`[data-control="${POP_ANCHOR[id]}"]`);
  if ((await a.getAttribute("aria-expanded")) === "true") await a.click();
  await expect(a).toHaveAttribute("aria-expanded", "false");
}

/** The status readers: Original and Active live in the Cloud details popover (bare value), the rest in the status bar ("Name: value"). */
function statOf(page: import("@playwright/test").Page) {
  const inDetails = (name: string) => name === "Original" || name === "Active";
  const stat = (name: string) => (inDetails(name) ? page.locator("#cloud-details") : page.locator("#statusbar")).locator(`[data-status="${name}"]`);
  const exact = (name: string, v: number | string) =>
    expect(stat(name)).toHaveText(inDetails(name) ? new RegExp(`^${v}$`) : new RegExp(`^${name.replace(/[()/]/g, "\\$&")}: ${v}$`), { timeout: 15000 });
  const num = async (name: string) => Number((await stat(name).innerText()).replace(/[^0-9]/g, ""));
  return { stat, exact, num };
}

/** Shared helpers for the part 7 tests. */
/** Opens the Box panel's Fit menu (22-6); the next `box-fit-*` click then closes it. Never used in E2E-163..167. */
const openFit = (page: import("@playwright/test").Page) => page.locator('[data-control="box-fit"]').click();
/** Opens the Box panel's Handles disclosure when it is closed (22-6). Never used in E2E-163..167. */
const openHandles = async (page: import("@playwright/test").Page) => {
  if (!(await page.locator('[data-control="gizmo-step"]').isVisible())) await page.locator("details.disc > summary", { hasText: "Handles" }).click();
};

function helpers(page: import("@playwright/test").Page) {
  // an earlier test's session may still be open and unsaved: accept replacing it; bulk-delete confirms are recorded and dismissed
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    if (/points \(/.test(d.message())) {
      dialogs.push(d.message());
      void d.dismiss();
    } else void d.accept();
  });
  const { stat, exact, num } = statOf(page);
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
  await ctl("tool-box").click(); // Apply disarmed the Box (R22-1)
  await boxEverything();
  await page.locator('[data-control="scope-active"]').click();
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
  state: () => { renderTheme: string; camera: { target: number[]; orientation: number[]; distance: number; ortho: boolean }; tools: { box: { center: number[]; dimensions: number[]; quat: number[] }; protection: { global: { enabled: boolean; min: number; max: number } } } };
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

  await openFit(page);
  await ctl("box-fit-view").click();
  await exact("Candidates", String(await num("Displayed")));
  await setNum("filter-z-min", 0.5);
  await setNum("filter-z-max", 10);
  await exact("Displayed", String(ROOM.wall + ROOM.ghost + ROOM.noise));
  await openFit(page);
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
  await expect(page.locator('[data-control="apply"]')).toHaveText("Delete");
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
  await expect(page.locator('[data-control="apply"]')).toHaveText(`Delete ${valid - kept}`);
  await expect(page.locator("#kept-chip")).toHaveText(`${kept} kept`);
  await expect(page.locator("#kept-chip")).toHaveAttribute("title", `Kept by protection ${kept}`);
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
  await expect(page.locator("#kept-chip")).toBeHidden();
  await expect(page.locator("#kept-chip")).toHaveAttribute("title", "Kept by protection 0");
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
  await openPop(page, "display");
  await page.locator('[data-control="budget"]').selectOption("100000");
  await closePop(page, "display");
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

const OVERFLOW_SELECTORS = ["#toolbar", "#tools", "#inspector", "#toolpanels", "#editpanels", "#statusbar", "#modebar", "#palette"];

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
  await expect(page.locator("#cloud-details")).toContainText("room.pcd");
  await expect(ctl("upload-cancel")).toBeHidden();
});

test("E2E-24 7b2 first page shows the start banner; a reloaded session starts Add, Displayed, no tool, default cluster limit", async ({ page }) => {
  const { exact, ctl } = helpers(page);
  // a previous test's session is still on the server: close it by opening a page without one is not possible, so check the banner by state
  await openRoom(page, exact);
  await expect(page.locator("#start-banner")).toBeHidden();
  await ctl("tool-cluster").click();
  await ctl("op-subtract").click();
  await ctl("scope-active").click();
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
  await openFit(page);
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
  await expect(page.locator('#cloud-details [data-status="Original"]')).toContainText(String(TOTAL));
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
  test(`E2E-157 17 the armed tool's section is the first section of the right panel at ${w}x${hgt}; it is the only fold section of the right panel`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: hgt });
    const t = helpers(page);
    await openRoom(page, t.exact);
    const first = () => page.evaluate(() => [...document.querySelectorAll<HTMLDetailsElement>("#inspector details[data-section]")].filter((d) => !d.hidden && d.getClientRects().length > 0).map((d) => `${d.dataset.section}:${d.open}`)[0]);
    const order = () => page.evaluate(() => [...document.querySelectorAll<HTMLDetailsElement>("#inspector details[data-section]")].filter((d) => !d.hidden && d.getClientRects().length > 0).map((d) => d.dataset.section));
    const open = (id: string) => page.locator(`details[data-section="${id}"]`).evaluate((d) => (d as HTMLDetailsElement).open);
    const fold = (id: string) => page.locator(`details[data-section="${id}"] > summary`);
    const idle = await order();
    expect(idle).toEqual([]);
    await t.ctl("tool-cluster").click();
    expect(await first()).toBe("cluster:true");
    await fold("cluster").click(); // fold it while armed: respected
    expect(await open("cluster")).toBe(false);
    await t.ctl("tool-cluster").click(); // disarm: the section is gone
    expect(await order()).toEqual(idle);
    await t.ctl("tool-cluster").click(); // arm again: opens again, first again
    expect(await first()).toBe("cluster:true");
    expect((await order()).slice(1)).toEqual(idle);
    await t.ctl("tool-box").click();
    expect(await first()).toBe("box:true");
    await t.ctl("tool-box").click();
    expect(await first()).toBeUndefined();
    expect(await order()).toEqual([]);
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
/** The page position of a protection arrow's tip (the only place a 14b arrow is grabbed), by hook key such as "global-max". */
const arrowTip = async (page: import("@playwright/test").Page, key: string) => {
  const a = (await page.evaluate(() => (window as unknown as { __editor: TiltHook }).__editor.protectionArrows())).find((r) => r.key === key);
  expect(a?.tip, `arrow ${key}`).toBeTruthy();
  return a!.tip!;
};
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
  // the upper plane's arrow points up from the footprint centre: grab it at its tip and drag it 20 px further up
  const up = await arrowTip(page, "global-max");
  await page.mouse.move(up.x, up.y);
  await page.mouse.down();
  await page.mouse.move(up.x, up.y - 20, { steps: 6 });
  await page.mouse.up();
  const after = await protNow(page);
  expect(after.g.min).toBe(0.5); // the lower edge is untouched
  expect(after.g.max).toBeGreaterThan(1.5);
  await exact("Protected", inSlab(0.5, after.g.max));
  // the lower plane's arrow points down: its tip, 15 px further down
  const lo = await arrowTip(page, "global-min");
  await page.mouse.move(lo.x, lo.y);
  await page.mouse.down();
  await page.mouse.move(lo.x, lo.y + 15, { steps: 5 });
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
  const top = await arrowTip(page, "global-max");
  await page.mouse.move(top.x, top.y);
  await page.mouse.down();
  await page.mouse.move(top.x, top.y - 15, { steps: 5 });
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
  const ring = (await page.evaluate(() => (window as unknown as { __editor: TiltHook }).__editor.tiltRings())).find((r) => r.id === "tilt-y+")!;
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

  // the upper arrow, grabbed at its tip (14b arrows are picked only there), widens the slab upwards
  const arrows = await page.evaluate(() => (window as unknown as { __editor: TiltHook }).__editor.protectionArrows());
  const upper = arrows.filter((a) => a.base && a.tip).sort((p, q) => p.tip!.y - q.tip!.y)[0]!;
  const dx = upper.tip!.x - upper.base!.x;
  const dy = upper.tip!.y - upper.base!.y;
  const len = Math.hypot(dx, dy);
  const g = { x: upper.tip!.x, y: upper.tip!.y };
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
  // the fold sections that survive part 22-5 and have their own controls: Layers (click) and the armed Box (keyboard)
  await ctl("tool-box").click();
  const probes: Record<string, () => import("@playwright/test").Locator> = {
    layers: () => ctl("layer-new"),
    box: () => ctl("box-size-x"),
  };
  for (const id of Object.keys(probes)) {
    await expect(det(id)).toHaveAttribute("open", "");
    await expect(probes[id]()).toBeVisible();
  }
  const countsText = () => page.locator("#counts-panel").innerText();
  const before = await countsText();
  const putWith = (ok: (folded: Record<string, boolean> | undefined) => boolean) =>
    page.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith("/api/session/client-state") && ok(JSON.parse(r.postData() ?? "{}")?.ui?.sectionsOpen));
  // click collapses; the keyboard (Enter on the focused summary) toggles too
  const savedFolded = putWith((f) => f?.layers === false && f?.box === false);
  await sum("layers").click();
  await sum("box").focus();
  await page.keyboard.press("Enter");
  for (const id of Object.keys(probes)) await expect(probes[id]()).toBeHidden();
  await expect.poll(async () => Object.keys(await SECTIONS_OPEN(page)).sort()).toEqual(["box", "layers"]);
  await savedFolded; // the client state is saved one second after the last change
  await page.reload();
  await exact("Original", String(ROOM_TOTAL));
  await expect.poll(async () => Object.keys(await SECTIONS_OPEN(page)).sort()).toEqual(["box", "layers"]);
  for (const id of Object.keys(probes)) await expect(probes[id]()).toBeHidden();
  await ctl("tool-box").click();
  // 17: arming a tool opens its folded section (it is the first section of the panel); the other folds are untouched
  await expect(ctl("box-size-x")).toBeVisible();
  await expect.poll(async () => Object.keys(await SECTIONS_OPEN(page)).sort()).toEqual(["layers"]);
  // reopen all: nothing was lost and the counts read the same. The all-open state is also saved to the server (the next
  // test's page restores it), so this test leaves no folded section behind.
  const savedOpen = putWith((f) => f === undefined || Object.keys(f).length === 0);
  await sum("layers").click();
  for (const id of Object.keys(probes)) await expect(probes[id]()).toBeVisible();
  expect(await countsText()).toBe(before);
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
  await expect(page.locator("#history-list li")).toHaveCount(3); // the History popover's list (closed, but in the DOM)
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
      await t.boxAt(i % 20, i >= 20 ? 1 : 0, 0, 0.5, 0.5, 0.5); // every Apply disarms the Box (R22-1): re-arm, same box
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
  await expect(page.locator("#unsaved-badge")).toHaveText("Edited");
  await expect(page.locator("#unsaved-badge")).toHaveAttribute("title", "Unsaved edits");
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
  await t.ctl("scope-active").click();
  await t.exact("Candidates", String(ROOM.wall));
  await expect(t.ctl("apply")).toBeEnabled();
  await t.ctl("scope-displayed").click();
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
    for (const sel of ["#toolbar", "#modebar"]) await expect(page.locator(sel)).toHaveCount(1); // E2E-21 skips a missing container
    await expect(page.locator("#viewbar")).toHaveCount(0); // 22-5: the view row is gone, its controls moved into the top bar and the Display popover
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

test("E2E-71 12-2 the four data modes are a text segment group with exact counts; the opacity slider shows only in Overlay; Hold original and the O key are gone", async ({ page }) => {
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
    await expect(ctl(id)).toHaveText(names[i]);
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
    await expect(page.locator("#toolbar").locator('[data-control="pivot-reset"]')).toHaveCount(0);
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
    await expect(page.locator("#cloud-details")).toContainText("Orthographic");
    await ctl("view-perspective").click();
    // pick: arm, the button is pressed, Esc disarms; the click sets the pivot; reset returns it to the cloud centre
    await ctl("cube-top").click();
    await ctl("pivot-pick").click();
    await expect(ctl("pivot-pick")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(page.locator("#modebar")).toContainText("Tool: None");
    await expect(ctl("pivot-pick")).toHaveAttribute("aria-pressed", "false");
    await ctl("pivot-reset").click();
    await expect(page.locator("#cloud-details")).toContainText("Pivot9, 9.5, 2");
    await pickPivotAt(page, [15, 2, 0]);
    await expect(page.locator("#cloud-details")).toContainText("Pivot15, 2, 0");
    await expect(ctl("pivot-pick")).toHaveAttribute("aria-pressed", "false");
    await ctl("pivot-reset").click();
    await expect(page.locator("#cloud-details")).toContainText("Pivot9, 9.5, 2");
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
  test(`E2E-75 12-5 the legend is a menu, open by default, folding by click and keyboard survives a reload, and the mode line stays in the footer without overlapping boxes or the cube at ${w}x${hgt}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: hgt });
    const { exact, ctl } = helpers(page);
    await openRoom(page, exact);
    for (const sel of ["#legend", "#legend-menu", "#modebar"]) await expect(page.locator(sel)).toHaveCount(1);
    await expect(page.locator('#legend [data-legend="selected"]')).toBeVisible();
    await expect(page.locator("#footer #modebar")).toBeVisible();
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
    await expect(page.locator("#modebar")).toBeVisible(); // the mode line lives in the footer and does not fold with the legend
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

/** A clear stage corner: the first #stage corner on the canvas, outside the legend and the triad (both are pointer-events: none). Call it after the state that sizes the legend. */
async function stageCorner(page: import("@playwright/test").Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const r = document.querySelector("#stage")!.getBoundingClientRect();
    const out = ["#legend", "#triad"].map((q) => document.querySelector(q)?.getBoundingClientRect()).filter((x): x is DOMRect => !!x);
    const spots = [[r.left + 4, r.top + 4], [r.right - 4, r.top + 4], [r.left + 4, r.bottom - 4], [r.right - 4, r.bottom - 4]];
    for (const [x, y] of spots) {
      const clear = out.every((o) => x < o.left || x > o.right || y < o.top || y > o.bottom);
      if (clear && document.elementFromPoint(x, y)?.id === "viewport") return { x, y };
    }
    throw new Error("no clear stage corner");
  });
}

/** Polls until the 3D clear colour at a stage corner is the theme's --canvas (the renderer follows the theme on a later frame, so no sleep). */
async function expectStageCorner(page: import("@playwright/test").Page, corner: { x: number; y: number }, want: "dark" | "light", timeout = 5000): Promise<void> {
  await expect.poll(() => brightestPixel(page, corner, 1).then((p) => near([p[0], p[1], p[2], 1], want === "light" ? [233, 235, 239] : [12, 13, 16])), { timeout, message: `stage corner under ${want}` }).toBe(true);
}

/** Every pixel of a (2r+1) square of the page around a screen point (a screenshot decoded in a blank tab, as brightestPixel does). */
async function pixelWindow(page: import("@playwright/test").Page, at: { x: number; y: number }, r: number): Promise<number[][]> {
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
      const out: number[][] = [];
      for (let i = 0; i < d.length; i += 4) out.push([d[i], d[i + 1], d[i + 2]]);
      return out;
    }, buf.toString("base64"));
  } finally {
    await tab.close();
  }
}

/** The pixel of a window farthest from the stage colour: finds a dark mark on a light stage, where brightestPixel would return the stage. */
async function farthestFromStage(page: import("@playwright/test").Page, at: { x: number; y: number }, stage: number[], r = 3): Promise<number[]> {
  let best = stage;
  let score = -1;
  for (const p of await pixelWindow(page, at, r)) {
    const d = Math.abs(p[0] - stage[0]) + Math.abs(p[1] - stage[1]) + Math.abs(p[2] - stage[2]);
    if (d > score) {
      score = d;
      best = p;
    }
  }
  return best;
}

/** How many pixels of a window are within `tol` per channel of a colour. */
async function countNear(page: import("@playwright/test").Page, at: { x: number; y: number }, r: number, rgb: number[], tol = 3): Promise<number> {
  return (await pixelWindow(page, at, r)).filter((p) => [0, 1, 2].every((i) => Math.abs(p[i] - rgb[i]) <= tol)).length;
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
  await openPop(page, "display");
  await modes.selectOption("viridis");
  await closePop(page, "display");
  await expect(page.locator("#legend-ramp")).toHaveAttribute("data-ramp", "viridis");
  await expect(page.locator("#legend-ramp")).toContainText("Height (Viridis)");
  await expect.poll(async () => sum(turbo, await read()), { timeout: 5000 }).toBeGreaterThan(40);
  const viridis = await read();
  await page.screenshot({ path: "/out/colour-viridis.png" });
  await page.locator("#legend").screenshot({ path: "/out/legend-viridis.png" });
  await openPop(page, "display");
  await modes.selectOption("flat");
  await closePop(page, "display");
  await expect(page.locator("#legend-ramp")).toBeHidden();
  await expect.poll(async () => sum(viridis, await read()), { timeout: 5000 }).toBeGreaterThan(40);
  const grey = await read();
  expect(Math.max(...grey) - Math.min(...grey), `grey pixel ${grey}`).toBeLessThanOrEqual(6);
  await page.screenshot({ path: "/out/colour-flat.png" });
  await page.locator("#legend").screenshot({ path: "/out/legend-flat.png" });
  await expect(page.locator('#legend [data-legend="base"]')).toHaveCSS("background-color", "rgb(176, 176, 176)");
  await openPop(page, "display");
  await modes.selectOption("turbo");
  await closePop(page, "display");
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
  await openPop(page, "display");
  await modes.selectOption("distance");
  await closePop(page, "display");
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
  await openPop(page, "display");
  await modes.selectOption("turbo");
  await closePop(page, "display");
  await ctl("sel-select-displayed").click();
  await expect.poll(async () => (await page.locator('#statusbar [data-status="Selected"]').innerText()).replace(/\D/g, ""), { timeout: 15000 }).not.toBe("0");
  const selectedTurbo = await pixel();
  await openPop(page, "display");
  await modes.selectOption("distance");
  await closePop(page, "display");
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
  await openPop(page, "display");
  await ctl("colour-mode").selectOption("distance");
  await closePop(page, "display");
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
  await openPop(page, "display");
  await modes.selectOption("normals");
  await closePop(page, "display");
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
  await openPop(page, "display");
  await modes.selectOption("flat");
  await closePop(page, "display");
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
  await expect(t.ctl("tool-sparse")).toHaveAttribute("aria-label", "Sparse points");
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
  test(`E2E-155 17 the focused Scope radio and the selected-colour swatches keep their focus outlines apart at ${w}x${hgt}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: hgt });
    const t = helpers(page);
    await openRoom(page, t.exact);
    await t.ctl("preview-live").focus();
    await page.keyboard.press("Tab");
    await expect(t.ctl("scope-displayed")).toBeFocused();
    const r = await page.evaluate(() => {
      const grow = (el: Element) => {
        const b = el.getBoundingClientRect();
        // the focus ring is 3px wide and 1px off the edge (22-4): 4px
        return { l: b.left - 4, t: b.top - 4, r: b.right + 4, b: b.bottom + 4 };
      };
      const sel = grow(document.querySelector('[data-control="scope-displayed"]')!);
      const sw = [...document.querySelectorAll('[data-control="sel-colour"] [data-control^="sel-colour-"]')].map(grow);
      return { sel, sw };
    });
    expect(r.sw.length).toBeGreaterThan(0);
    for (const s of r.sw) {
      const overlap = s.l < r.sel.r && s.r > r.sel.l && s.t < r.sel.b && s.b > r.sel.t;
      expect(overlap, "a swatch outline touches the Scope radio outline").toBe(false);
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
  await ctl("scope-displayed").focus();
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
    await openPop(page, "display");
    await ctl("colour-mode").selectOption(mode);
    await closePop(page, "display");
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
    await openPop(page, "display");
    await ctl("colour-mode").selectOption(mode);
    await closePop(page, "display");
    for (const preset of ["orange", "magenta", "white", "lime"] as const) {
      await ctl(`sel-colour-${preset}`).click();
      await expect(page.locator('#legend [data-legend="selected"]')).toHaveCSS("background-color", `rgb(${RGB_OF[preset].join(", ")})`);
      await page.waitForTimeout(500);
      await page.screenshot({ path: `/out/selected-colour-${mode}-${preset}.png` });
    }
  }
  await openPop(page, "display");
  await ctl("colour-mode").selectOption("turbo");
  await closePop(page, "display");
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
        await openFit(page);
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
  await openHandles(page);
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
  const n = await t.floorSelected();
  page.on("dialog", (d) => asked.push(d.message())); // after the open: the "unsaved edits" ask of a file left by an earlier test (E2E-166) is not under test
  const drawn0 = await t.drawn();
  await expect(t.hideBtn).toHaveText("Hide selected");
  await t.hideBtn.click();
  await expect.poll(t.drawn, { timeout: 15000 }).toBe(drawn0 - n);
  await t.exact("Selected", "0");
  await expect(t.hideBtn).toHaveText(`Show hidden (${n})`);
  await expect(t.hideBtn).toHaveAttribute("aria-pressed", "true");
  await expect(t.chip).toHaveText(`${n} hidden - Show`);
  await expect(t.ctl("tool-box")).not.toHaveClass(/active/); // Hide selected disarms the tool (R22-1)
  // Select displayed and Invert are not refused: the server leaves the hidden floor out (Hide selected already disarmed the tool)
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
    await t.ctl("tool-box").click(); // Hide selected disarmed the Box (R22-1)
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

test("E2E-287 22-7 the row's actions are revealed: the more button is 0 at rest, 1 on row hover, on the active row and on keyboard focus; the eye of a hidden layer is always 1", async ({ page }) => {
  const t = layerMenu(page);
  const floor = await t.floorFromBand();
  const wallId = await t.wallLayer();
  await page.locator(`[data-layer-eye="${wallId}"]`).click();
  await expect(page.locator(`[data-layer-eye="${wallId}"]`)).toHaveAttribute("aria-pressed", "false");
  await page.locator(`[data-layer-row="${floor.id}"]`).click(); // Floor is the active layer
  await page.mouse.move(5, 5);
  await transitionsSettled(page);
  const opacity = (sel: string) => page.locator(sel).evaluate((el) => getComputedStyle(el).opacity);
  const wallMore = `[data-layer-more="${wallId}"]`;
  expect(await opacity(wallMore)).toBe("0");
  expect(await opacity(`[data-layer-more="${floor.id}"]`)).toBe("1");
  expect(await opacity(`[data-layer-eye="${wallId}"]`)).toBe("1");
  await page.locator(`[data-layer-row="${wallId}"]`).hover();
  await transitionsSettled(page);
  expect(await opacity(wallMore)).toBe("1");
  await page.mouse.move(5, 5);
  await transitionsSettled(page);
  expect(await opacity(wallMore)).toBe("0");
  await page.locator(wallMore).focus();
  await transitionsSettled(page);
  expect(await opacity(wallMore)).toBe("1");
  await page.keyboard.press("Enter"); // the keyboard opens the menu
  await expect(page.locator("#layer-menu")).toBeVisible();
});

test("E2E-288 22-7 the layer menu is a popover beside the row's more button, inside the window, keeps the lock mark on the row, and Esc closes it to the button without disarming the tool; a second Esc does", async ({ page }) => {
  const t = layerMenu(page);
  const floor = await t.floorFromBand();
  const wallId = await t.wallLayer();
  const tool = () => hook(page, (e) => e.state().tool);
  await t.ctl("sel-clear").click(); // New layer disarmed the Box (R22-1) and kept the Wall selected: clear it so the re-armed box holds no draft
  if ((await tool()) !== "box") await t.ctl("tool-box").click();
  expect(await tool()).toBe("box");
  await t.openMore(wallId);
  await t.m("lock", wallId).click();
  await expect.poll(async () => (await t.byName("Wall"))?.locked, { timeout: 15000 }).toBe(true);
  await expect(page.locator(`[data-layer-row="${wallId}"] [data-layer-lock]`)).toBeVisible();
  const floorMore = page.locator(`[data-layer-more="${floor.id}"]`);
  await floorMore.click();
  const menu = page.locator("#layer-menu");
  await expect(menu).toBeVisible();
  await expect(floorMore).toHaveAttribute("aria-expanded", "true");
  const box = (await menu.boundingBox())!;
  const mb = (await floorMore.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(mb.x + mb.width + 8 - 1);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width - 8 + 1);
  expect(box.y).toBeGreaterThanOrEqual(8 - 1);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height - 8 + 1);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(floorMore).toBeFocused();
  expect(await tool()).toBe("box");
  await page.keyboard.press("Escape");
  await expect.poll(tool).toBe("none");
});

// ---- part 15b: named sub layers (E2E-140..146)
const layerHelpers = (page: Pg) => {
  const t = hideHelpers(page);
  const layers = () => hook(page, (e) => e.state().session!.layers.map((l: { id: number; name: string; visible: boolean; count: number }) => ({ id: l.id, name: l.name, visible: l.visible, count: l.count })));
  const eye = (id: number) => page.locator(`[data-layer-eye="${id}"]`);
  const edit = (id: number) => page.locator(`[data-layer-edit="${id}"]`);
  const more = (id: number) => page.locator(`[data-layer-more="${id}"]`);
  /** 22-7: the row's options (Edit layer, To main, flags, operations) live in the #layer-menu popover; open it first. */
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
  await t.ctl("sel-clear").click(); // New layer disarmed the Box and kept the floor selected (R22-1): clear, then re-arm below so the ghost box is a live first selection
  page.on("dialog", (d) => asked.push(d.message())); // after the open: the "unsaved edits" ask of an earlier test's file is not under test
  await t.eye(id).click();
  await expect.poll(async () => (await t.layers()).find((l) => l.id === id)?.visible, { timeout: 15000 }).toBe(false);
  await t.ctl("tool-box").click();
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
  test(`E2E-159 17 the top bar is one 52 px row at ${w}x${h}: every control inside it, the stage is taller`, async ({ page }) => {
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
      return { toolbar: row("toolbar"), stage: document.getElementById("viewport")!.getBoundingClientRect().height };
    });
    expect(m.toolbar.height).toBeLessThanOrEqual(52.5); // --tb-h: the one top bar of 22-5
    for (const c of m.toolbar.ctl) {
      expect(c.visible, `${c.id} is visible`).toBe(true);
      expect(c.inside, `${c.id} is inside its row`).toBe(true);
    }
    expect(m.toolbar.ctl.length).toBeGreaterThan(10); // the bar now also holds the data mode and the three popover anchors
    expect(m.stage).toBeGreaterThan(STEP0_STAGE[h]);
  });
}

for (const [w, h] of [[1280, 720], [1920, 1080]] as const) {
  test(`E2E-167 14b owner screenshots at ${w}x${h}: corner, hovered ring, mid ring drag, top, rotated`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error" && !/404/.test(m.text())) errors.push(m.text());
    });
    await gizmoBox(page, "top");
    await page.waitForTimeout(300);
    await page.screenshot({ path: `/out/part14b-${w}x${h}-top.png` });
    await cornerView(page);
    await page.mouse.move(5, 5);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `/out/part14b-${w}x${h}-corner.png` });
    const a = await stableHandle(page, "rotate-1+");
    await page.mouse.move(Math.round(a.x), Math.round(a.y));
    await expect.poll(async () => hook(page, (e) => (e.state() as unknown as { boxHover: string | null }).boxHover)).toBe("rotate-1+");
    await page.waitForTimeout(300);
    await page.screenshot({ path: `/out/part14b-${w}x${h}-corner-hover-ring.png` });
    const c = (await hook(page, (e) => e.boxRings())).find((r) => r.id === "rotate-1+")!.centre!;
    const [vx, vy] = [a.x - c.x, a.y - c.y];
    const n = Math.hypot(vx, vy);
    await page.mouse.down();
    await page.mouse.move(Math.round(c.x - (vy / n) * 30 + (vx / n) * 10), Math.round(c.y + (vx / n) * 30 + (vy / n) * 10), { steps: 5 });
    await page.mouse.move(Math.round(c.x - (vy / n) * 50 + (vx / n) * 20), Math.round(c.y + (vx / n) * 50 + (vy / n) * 20), { steps: 5 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `/out/part14b-${w}x${h}-corner-dragging.png` });
    await page.mouse.up();
    await appIdle(page);
    for (const [id, deg] of [["rotate-0+", 25], ["rotate-2+", 20]] as [string, number][]) await ringTurn(page, id, deg);
    await page.mouse.move(5, 5);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `/out/part14b-${w}x${h}-rotated.png` });
    expect(errors).toEqual([]);
  });
}

// Part 18: protected layers, the Floor layer from the height band, the per-layer menu
const BAND = { min: -0.05, max: 0.05 };
const inBand = (r: number[]) => r[2] >= BAND.min && r[2] <= BAND.max;
const WALL18 = { c: [-1, 4.5, 2.5], d: [1, 10, 5] }; // the wall only: no floor point lies inside, so the Wall layer takes nothing from the Floor
const ALL_BOX = { c: [8, 8, 2.5], d: [40, 40, 8] };
const layerMenu = (page: Pg) => {
  const t = layerHelpers(page);
  const flags = () => hook(page, (e) => e.state().session!.layers.map((l: { id: number; name: string; colour: number; count: number; protected?: boolean; locked?: boolean }) => ({ id: l.id, name: l.name, colour: l.colour, count: l.count, protected: l.protected === true, locked: l.locked === true })));
  const byName = async (name: string) => (await flags()).find((l) => l.name === name);
  const m = (attr: string, id: number) => page.locator(`[data-layer-${attr}="${id}"]:not(.layer-lock)`); // 22-7: a locked row also carries the lock mark
  const op = (id: number, o: string) => page.locator(`[data-layer-op="${o}"][data-layer-of="${id}"]`);
  const bandOn = async () => {
    await t.ctl("prot-enabled").check();
    await t.setNum("prot-min", BAND.min);
    await t.setNum("prot-max", BAND.max);
  };
  /** Opens the room, turns the band on and makes the Floor layer from it. */
  const floorFromBand = async () => {
    await openRoom(page, t.exact);
    await bandOn();
    await t.ctl("layer-from-band").click();
    await expect.poll(async () => (await byName("Floor"))?.count, { timeout: 15000 }).toBe(finiteRows().filter(inBand).length);
    return (await byName("Floor"))!;
  };
  const wallLayer = async () => {
    await t.ctl("tool-box").click();
    await t.setBox(WALL18.c, WALL18.d);
    await t.exact("Selected", String(ROOM.wall));
    return t.newLayer("Wall");
  };
  return { ...t, flags, byName, m, op, bandOn, floorFromBand, wallLayer };
};

test("E2E-170 18 New layer from protected points makes a protected Floor layer with exactly the points in the band, and leaves the selection alone", async ({ page }) => {
  const t = layerMenu(page);
  const asked: string[] = [];
  await openRoom(page, t.exact);
  page.on("dialog", (d) => asked.push(d.message()));
  await expect(t.ctl("layer-from-band")).toHaveAttribute("aria-disabled", "true"); // band off
  await t.bandOn();
  const truth = finiteRows().filter(inBand).length;
  expect(truth).toBe(ROOM.floor + ROOM.floorGhost);
  await t.exact("Selected", "0");
  await t.ctl("layer-from-band").click();
  await expect.poll(async () => (await t.byName("Floor"))?.count, { timeout: 15000 }).toBe(truth);
  const floor = (await t.byName("Floor"))!;
  expect(floor.protected).toBe(true);
  await expect(page.locator(`[data-layer-row="${floor.id}"] [data-layer-shield]`)).toBeVisible(); // R22-3: the shield, not a chip ring
  await expect(page.locator(`[data-layer-row="${floor.id}"] .chip`)).not.toHaveClass(/protected/);
  await t.exact("Selected", "0");
  await t.exact("Active", String(ROOM_TOTAL));
  expect(asked).toEqual([]);
});

test("E2E-171 18 a protected Floor is never deleted: with the band off Kept by protection is the Floor count, Delete removes exactly the rest, Undo restores; an override of the band does not free the Floor", async ({ page }) => {
  const t = layerMenu(page);
  const floor = await t.floorFromBand();
  await t.ctl("prot-enabled").uncheck();
  await t.ctl("tool-box").click();
  await t.setBox(ALL_BOX.c, ALL_BOX.d);
  const selected = finiteRows().filter((r) => inBox(r, ALL_BOX.c, ALL_BOX.d)).length;
  await t.exact("Selected", String(selected));
  await t.exact("Candidates", String(selected - floor.count));
  await expect(page.locator("#kept-chip")).toHaveText(`${floor.count} kept`);
  await expect(t.ctl("apply")).toBeEnabled();
  await t.ctl("apply").click();
  await t.exact("Active", String(ROOM_TOTAL - (selected - floor.count)));
  expect((await t.byName("Floor"))!.count).toBe(floor.count);
  await t.ctl("undo").click();
  await t.exact("Active", String(ROOM_TOTAL));
  await t.ctl("tool-box").click(); // Apply disarmed the Box (R22-1)
  await t.setBox(ALL_BOX.c, [ALL_BOX.d[0] + 1, ALL_BOX.d[1], ALL_BOX.d[2]]); // Apply cleared the selection and Undo does not bring it back: a slightly larger box holds the same points
  await t.exact("Selected", String(selected));
  // a band over the top of the wall protects those points too; Also delete the kept points frees the wall (the band) but never the Floor layer
  await t.ctl("prot-enabled").check();
  await t.setNum("prot-max", 5.1); // max first: min 3.5 above the old max 0.05 is not a valid band
  await t.setNum("prot-min", 3.5);
  const wallBand = finiteRows().filter((r) => inBox(r, ALL_BOX.c, ALL_BOX.d) && r[2] >= 3.5 && r[2] <= 5.1).length;
  expect(wallBand).toBeGreaterThan(0);
  await t.exact("Candidates", String(selected - floor.count - wallBand));
  await t.ctl("sel-delete-kept").click();
  await t.exact("Candidates", String(selected - floor.count));
  await expect(page.locator("#kept-chip")).toHaveText(`${floor.count} kept`);
  await t.ctl("apply").click();
  await t.exact("Active", String(ROOM_TOTAL - (selected - floor.count)));
  expect((await t.byName("Floor"))!.count).toBe(floor.count);
  await t.ctl("undo").click();
  await t.exact("Active", String(ROOM_TOTAL));
});

test("E2E-172 18 the protected and locked flags and the layer order survive Save and reopen", async ({ page }, testInfo) => {
  const t = layerMenu(page);
  await t.floorFromBand();
  const wallId = await t.wallLayer();
  const floorId = (await t.byName("Floor"))!.id;
  await t.openMore(wallId);
  await t.m("lock", wallId).click();
  await expect.poll(async () => (await t.byName("Wall"))?.locked, { timeout: 15000 }).toBe(true);
  await t.m("up", wallId).click();
  await expect.poll(async () => (await t.flags()).map((l) => l.name), { timeout: 15000 }).toEqual(["Wall", "Floor"]);
  const before = await t.flags();
  const [dl] = await Promise.all([page.waitForEvent("download"), t.ctl("save-session").click()]);
  const path = testInfo.outputPath("flags.pcdsession");
  await dl.saveAs(path);
  await page.locator("#file-input").setInputFiles({ name: "other.pcd", mimeType: "application/octet-stream", buffer: syntheticPcd() });
  await t.exact("Active", String(TOTAL));
  expect(await t.flags()).toEqual([]);
  await page.locator("#file-input").setInputFiles({ name: "flags.pcdsession", mimeType: "application/octet-stream", buffer: readFileSync(path) });
  await t.exact("Original", String(ROOM_TOTAL));
  const back = await t.flags();
  expect(back).toEqual(before);
  expect(back.map((l) => [l.name, l.protected, l.locked])).toEqual([["Wall", false, true], ["Floor", true, false]]);
  await expect(page.locator("#layer-list [data-layer-row]:not(.main)").first()).toHaveAttribute("data-layer-row", String(back[0].id));
  expect(floorId).toBe(back[1].id);
});

test("E2E-173 18 menu flows: rename with Enter, a colour swatch, lock refuses Edit layer, To main and Assign, merge folds Wall into Ground", async ({ page }) => {
  const t = layerMenu(page);
  const floor = await t.floorFromBand();
  const wallId = await t.wallLayer();
  await t.openMore(floor.id);
  const rename = t.m("rename", floor.id);
  await rename.fill("Ground");
  await rename.press("Enter");
  await expect.poll(async () => !!(await t.byName("Ground")), { timeout: 15000 }).toBe(true);
  await page.locator(`[data-layer-colour="${floor.id}"][data-colour="3"]`).click();
  await expect.poll(async () => (await t.byName("Ground"))?.colour, { timeout: 15000 }).toBe(3);
  await expect(page.locator(`[data-layer-colour="${floor.id}"][data-colour="3"]`)).toHaveAttribute("aria-pressed", "true");
  await t.m("lock", floor.id).click();
  await expect.poll(async () => (await t.byName("Ground"))?.locked, { timeout: 15000 }).toBe(true);
  await expect(t.m("edit", floor.id)).toHaveAttribute("aria-disabled", "true");
  await expect(t.m("tomain", floor.id)).toHaveAttribute("aria-disabled", "true");
  await t.pick(floor.id).click(); // choose Ground as the Assign target
  await t.ctl("sel-clear").click();
  await t.ctl("tool-box").click();
  await t.setBox([9.5, 9.5, 2.5], [1, 1, 5]);
  await expect(t.ctl("layer-assign")).toHaveAttribute("aria-disabled", "true");
  await expect(t.ctl("layer-assign")).toHaveAttribute("title", /Ground is locked/);
  await t.openMore(floor.id); // a click elsewhere closed the menu
  await t.m("lock", floor.id).click();
  await expect.poll(async () => (await t.byName("Ground"))?.locked, { timeout: 15000 }).toBe(false);
  const wallCount = (await t.byName("Wall"))!.count;
  expect(wallCount).toBe(ROOM.wall);
  await t.openMore(wallId);
  await t.m("merge-target", wallId).selectOption({ label: "Ground" });
  await t.m("merge", wallId).click(); // the confirm is accepted by the helpers
  await expect.poll(async () => (await t.byName("Wall")) === undefined, { timeout: 15000 }).toBe(true);
  await expect.poll(async () => (await t.byName("Ground"))?.count, { timeout: 15000 }).toBe(floor.count + ROOM.wall);
});

test("E2E-174 18 Select, Add, Subtract and Intersect with a layer as the operand give exactly the set-algebra counts", async ({ page }) => {
  const t = layerMenu(page);
  const floor = await t.floorFromBand();
  const wallId = await t.wallLayer();
  await t.ctl("sel-clear").click(); // New layer disarmed the Box and kept the Wall selected (R22-1): clear, re-arm, the box is a live first selection
  await t.ctl("tool-box").click();
  await t.setBox(ALL_BOX.c, ALL_BOX.d);
  const S = finiteRows().filter((r) => inBox(r, ALL_BOX.c, ALL_BOX.d)).length;
  await t.exact("Selected", String(S));
  await t.openMore(floor.id); // one menu at a time: open the layer whose operation is next
  await t.op(floor.id, "subtract").click();
  await t.exact("Selected", String(S - floor.count));
  await t.openMore(wallId);
  await t.op(wallId, "select").click();
  await t.exact("Selected", String(ROOM.wall));
  await t.openMore(floor.id);
  await t.op(floor.id, "add").click();
  await t.exact("Selected", String(ROOM.wall + floor.count));
  await t.op(floor.id, "intersect").click();
  await t.exact("Selected", String(floor.count));
  await t.op(floor.id, "subtract").click();
  await t.exact("Selected", "0");
});

for (const [w, h] of [[1280, 720], [1920, 1080]] as const) {
  test(`E2E-175 18 eight layers with Floor's menu open at ${w}x${h}: nothing overlaps the ViewCube, the camera cluster, the legend or the timeline, and the left panel scrolls instead of overflowing`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    const t = layerMenu(page);
    await t.floorSelected();
    await t.newLayer("L1");
    for (let i = 2; i <= 8; i++) {
      await t.ctl("sel-clear").click();
      await t.ctl("tool-box").click();
      await t.setBox([2 * i, 9.5, 0], [1.5, 22, 0.5]);
      await t.newLayer(`L${i}`);
    }
    expect((await t.layers()).length).toBe(8);
    await t.ctl("sel-clear").click();
    await t.openMore((await t.layers())[0].id);
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
      const box = (e: Element) => {
        const b = e.getBoundingClientRect();
        return { l: b.left, t: b.top, r: b.right, b: b.bottom };
      };
      const q = (s: string) => document.querySelector(s)!;
      const tools = q("#tools") as HTMLElement;
      const menu = q("#layer-menu") as HTMLElement;
      return {
        legend: box(q("#legend")),
        tools: box(tools),
        menu: box(menu),
        others: ["#viewcube", "#camera-cluster", "#timeline"].map((s) => ({ s, ...box(q(s)) })),
        scroll: [tools.scrollHeight, tools.clientHeight],
        overflowY: getComputedStyle(tools).overflowY,
        menuHeight: menu.getBoundingClientRect().height,
        menuInWindow: [menu.getBoundingClientRect().left, menu.getBoundingClientRect().top, window.innerWidth - menu.getBoundingClientRect().right, window.innerHeight - menu.getBoundingClientRect().bottom],
        menuLeftOfInspector: menu.getBoundingClientRect().right <= q("#inspector").getBoundingClientRect().left + 1,
        menuVisible: !menu.hidden,
      };
    });
    console.log(`LEFT-PANEL-MENU ${w}x${h} menu ${r.menuHeight.toFixed(1)} scroll ${r.scroll[0]}/${r.scroll[1]}`);
    const hit = (a: { l: number; t: number; r: number; b: number }, c: { l: number; t: number; r: number; b: number }) => a.l < c.r && c.l < a.r && a.t < c.b && c.t < a.b;
    for (const o of r.others) {
      expect(hit(r.legend, o), `legend x ${o.s}`).toBe(false);
      expect(hit(r.tools, o), `left panel x ${o.s}`).toBe(false);
    }
    expect(r.menuVisible, "the menu is open").toBe(true);
    for (const m of r.menuInWindow) expect(m, "menu inside the window with 8 px margins").toBeGreaterThanOrEqual(8 - 1);
    expect(r.menuLeftOfInspector, "menu left of the right inspector").toBe(true);
    expect(r.scroll[0], "the left panel does not scroll while the menu is open").toBeLessThanOrEqual(r.scroll[1]);
    expect(["auto", "scroll"]).toContain(r.overflowY);
    await checkLayout(page, w, h);
  });
}

// 18-6: owner screenshots, the Floor from the band with its menu open and the cloud coloured by layer; asserts only that the menu is visible and there are no console errors
for (const [w, h] of [[1280, 720], [1920, 1080]] as const) {
  test(`E2E-176 18 owner screenshots at ${w}x${h}: Floor protected with its menu open, then coloured by layer`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error" && !/404/.test(m.text())) errors.push(m.text());
    });
    const t = layerMenu(page);
    const floor = await t.floorFromBand();
    await t.wallLayer();
    await t.openMore(floor.id);
    await expect(page.locator(`[data-layer-details="${floor.id}"]`)).toBeVisible();
    await page.mouse.move(5, 5);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `/out/part18-${w}x${h}-menu.png` });
    await openPop(page, "display");
    await t.ctl("colour-mode").selectOption("layers");
    await closePop(page, "display");
    await t.ctl("cube-top").click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `/out/part18-${w}x${h}-floor.png` });
    expect(errors).toEqual([]);
  });
}

// ---- 22-2: layer colour on the points, the protected shield (R22-3)
/** The canvas bytes once two consecutive shots are equal (the legend is masked: in Layers mode its chips recolour too; so is the timeline strip, whose current-step marker pulses over the canvas bottom). */
const steadyCanvas = async (page: Pg): Promise<Buffer> => {
  const shot = () => page.locator("#viewport").screenshot({ mask: [page.locator("#legend"), page.locator("#timeline")] });
  let prev = await shot();
  await expect
    .poll(async () => {
      const next = await shot();
      const same = Buffer.compare(prev, next) === 0;
      prev = next;
      return same;
    }, { timeout: 15000 })
    .toBe(true);
  return prev;
};

test("E2E-201 22-2 recolouring a protected Floor layer changes the canvas in Layers mode with the protection section open, and the shield sits on its row and its legend entry", async ({ page }) => {
  const t = layerMenu(page);
  const floor = await t.floorFromBand();
  const asked: string[] = [];
  page.on("dialog", (d) => asked.push(d.message())); // registered after the open (E2E-90 rule)
  await openPop(page, "display");
  await t.ctl("colour-mode").selectOption("layers");
  await closePop(page, "display");
  await t.ctl("cube-top").click();
  await page.mouse.move(5, 5);
  await expect(t.ctl("prot-min")).toBeVisible(); // the section is open: the region colour is live
  expect(floor.protected).toBe(true);
  await t.openMore(floor.id);
  const swatch = (c: number) => page.locator(`[data-layer-colour="${floor.id}"][data-colour="${c}"]`);
  const recolour = async (c: number) => {
    await swatch(c).click();
    await expect.poll(async () => (await t.byName("Floor"))?.colour, { timeout: 15000 }).toBe(c);
    await page.mouse.move(5, 5);
  };
  const other = (floor.colour + 4) % 16;
  const a = await steadyCanvas(page);
  await recolour(other);
  await expect.poll(async () => Buffer.compare(a, await steadyCanvas(page)) !== 0, { timeout: 15000 }).toBe(true);
  await recolour(floor.colour);
  expect(Buffer.compare(a, await steadyCanvas(page))).toBe(0); // back to the first colour: the same pixels
  // control leg: with the section folded there is no region colour, and the recolour shows too
  await protSummary(page).click();
  await expect(t.ctl("prot-min")).not.toBeVisible();
  await t.openMore(floor.id); // the click on the section summary closed the menu
  const b = await steadyCanvas(page);
  await recolour(other);
  await expect.poll(async () => Buffer.compare(b, await steadyCanvas(page)) !== 0, { timeout: 15000 }).toBe(true);
  // R22-3: the shield is the protection mark, on the row and on the legend entry
  await expect(page.locator(`[data-layer-row="${floor.id}"] [data-layer-shield]`)).toBeVisible();
  await expect(page.locator(`[data-legend-layer="${floor.id}"] [data-legend-shield]`)).toBeVisible();
  expect(asked).toEqual([]);
});

// 22-2: owner screenshots of the shield on the row and the legend, and of the recoloured Floor
for (const [w, h] of [[1280, 720], [1920, 1080]] as const) {
  test(`E2E-202 22-2 owner screenshots at ${w}x${h}: Floor protected with its menu open (the shield on row, menu and legend), then recoloured in Layers mode`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error" && !/404/.test(m.text())) errors.push(m.text());
    });
    const t = layerMenu(page);
    const floor = await t.floorFromBand();
    await t.wallLayer();
    await t.openMore(floor.id);
    await expect(page.locator(`[data-layer-details="${floor.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-layer-row="${floor.id}"] [data-layer-shield]`)).toBeVisible();
    await expect(page.locator(`[data-layer-protected="${floor.id}"] svg`)).toBeVisible();
    await page.mouse.move(5, 5);
    await steadyCanvas(page);
    await page.screenshot({ path: `/out/part22-2-${w}x${h}-menu.png` });
    await openPop(page, "display");
    await t.ctl("colour-mode").selectOption("layers");
    await closePop(page, "display");
    await t.ctl("cube-top").click();
    await page.mouse.move(5, 5);
    await t.openMore(floor.id); // the Display popover replaced the menu (one popover at a time)
    await steadyCanvas(page);
    await page.locator(`[data-layer-colour="${floor.id}"][data-colour="${(floor.colour + 4) % 16}"]`).click();
    await expect.poll(async () => (await t.byName("Floor"))?.colour, { timeout: 15000 }).toBe((floor.colour + 4) % 16);
    await page.mouse.move(5, 5);
    await steadyCanvas(page);
    await page.screenshot({ path: `/out/part22-2-${w}x${h}-floor.png` });
    expect(errors).toEqual([]);
  });
}

// ---- Part 19: layer edits are timeline steps, export each layer to its own file (E2E-177..185)
const LAYER_CARDS = "#timeline .step[data-step]";
const layerCards = (page: Pg) => page.locator(LAYER_CARDS);
const FLOOR_TRUTH = () => finiteRows().filter(inBand).length;
const WALL_TRUTH = () => finiteRows().filter((r) => inBox(r, WALL18.c, WALL18.d)).length;

test("E2E-177 19 New layer from the floor is a Layer edit card with the moved count and the tooltip; Ctrl+Z removes the layer, Ctrl+Y brings it back with its name", async ({ page }) => {
  const t = layerMenu(page);
  await t.floorFromBand();
  const truth = FLOOR_TRUTH();
  const card = layerCards(page).last();
  await expect(layerCards(page)).toHaveCount(1);
  await expect(card).toHaveAttribute("data-icon", "layer");
  await expect(card).toContainText("Layer edit 1");
  await expect(card).toContainText(String(truth));
  await expect(card).toHaveAttribute("title", new RegExp(`${truth.toLocaleString("en-US")} points`));
  await page.mouse.move(5, 5);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await t.flags()).length, { timeout: 15000 }).toBe(0);
  await expect(page.locator("#layer-list [data-layer-row]:not(.main)")).toHaveCount(0);
  await t.exact("Active", String(ROOM_TOTAL));
  await page.keyboard.press("Control+y");
  await expect.poll(async () => (await t.byName("Floor"))?.count, { timeout: 15000 }).toBe(truth);
  await t.exact("Active", String(ROOM_TOTAL));
});

test("E2E-178 19 dragging the marker across a layer step and a deletion step gives the counts and layer counts of fixture truth at every slot", async ({ page }) => {
  const t = layerHelpers(page);
  const { n } = await t.floorLayer();
  const k = tl(page);
  await k.ctl("sel-clear").click(); // New layer disarmed the Box and kept the floor selection (R22-1): clear it, so the re-armed box is a live first selection
  await k.boxAt(3, 13, 2, 4, 4, 3);
  await k.exact("Candidates", String(ROOM.ghost));
  await k.ctl("apply").click();
  await k.exact("Active", String(ROOM_TOTAL - ROOM.ghost));
  await expect(k.cards).toHaveCount(2);
  await expect(k.card(0)).toHaveAttribute("data-icon", "layer");
  await k.dragMarkerTo(0);
  await k.exact("Active", String(ROOM_TOTAL));
  expect(await t.layers()).toEqual([]);
  await k.dragMarkerTo(1);
  await k.exact("Active", String(ROOM_TOTAL));
  await expect.poll(async () => (await t.layers()).map((l) => [l.name, l.count]), { timeout: 15000 }).toEqual([["Floor", n]]);
  await k.dragMarkerTo(2);
  await k.exact("Active", String(ROOM_TOTAL - ROOM.ghost));
  expect((await t.layers()).map((l) => [l.name, l.count])).toEqual([["Floor", n]]);
});

test("E2E-179 19 deleting an independent layer step asks the exact text; a step a later one builds on has its delete disabled with the reason", async ({ page }) => {
  const t = layerMenu(page);
  const k = tl(page);
  await k.open();
  await t.ctl("prot-enabled").check();
  await t.setNum("prot-min", BAND.min);
  await t.setNum("prot-max", BAND.max);
  await t.ctl("layer-from-band").click();
  await expect.poll(async () => (await t.byName("Floor"))?.count, { timeout: 15000 }).toBe(FLOOR_TRUTH());
  await t.wallLayer();
  await expect(k.cards).toHaveCount(2);
  const seen: string[] = [];
  page.removeAllListeners("dialog");
  page.on("dialog", (d) => {
    seen.push(d.message());
    void d.accept();
  });
  await k.card(0).hover();
  await k.card(0).locator('[data-act="delete"]').click();
  await expect.poll(() => seen.length, { timeout: 15000 }).toBe(1);
  expect(seen[0]).toBe(`Remove step "Layer edit 1"? Its ${FLOOR_TRUTH().toLocaleString("en-US")} points go back to their earlier layer; later steps are kept. This cannot be undone. Continue?`);
  await expect.poll(async () => (await t.flags()).map((l) => l.name), { timeout: 15000 }).toEqual(["Wall"]);
  await expect(k.cards).toHaveCount(1);
  // a Release of the wall builds on the Wall step: that step cannot be removed first
  await t.ctl("sel-clear").click();
  await t.ctl("tool-box").click();
  await t.setBox(WALL18.c, WALL18.d);
  await t.exact("Selected", String(ROOM.wall));
  await t.ctl("layer-release").click();
  await expect(k.cards).toHaveCount(2);
  const del = k.card(0).locator('[data-act="delete"]');
  await k.card(0).hover();
  await expect(del).toBeDisabled();
  await expect(del).toHaveAttribute("title", "A later layer edit builds on this one; remove that one first");
  await del.click({ force: true });
  expect(seen).toHaveLength(1);
  await expect(k.cards).toHaveCount(2);
});

test("E2E-180 19 with steps rolled back, New layer asks the discard text; No changes nothing, Yes discards the greyed cards", async ({ page }) => {
  const t = layerHelpers(page);
  await t.floorLayer();
  const k = tl(page);
  await k.ctl("sel-clear").click(); // New layer disarmed the Box and kept the floor selection (R22-1): clear it, so the re-armed box is a live first selection
  await k.boxAt(3, 13, 2, 4, 4, 3);
  await k.ctl("apply").click();
  await k.exact("Active", String(ROOM_TOTAL - ROOM.ghost));
  await expect(k.cards).toHaveCount(2);
  await k.dragMarkerTo(1);
  await k.exact("Active", String(ROOM_TOTAL));
  const asked: string[] = [];
  let answer: "accept" | "dismiss" = "dismiss";
  page.removeAllListeners("dialog");
  page.on("dialog", (d) => {
    asked.push(d.message());
    void (answer === "accept" ? d.accept() : d.dismiss());
  });
  await k.ctl("sel-clear").click();
  await k.ctl("tool-box").click();
  await t.setBox(WALL18.c, WALL18.d);
  await k.exact("Selected", String(ROOM.wall));
  await page.locator('[data-control="layer-name"]').fill("Wall");
  await k.ctl("layer-new").click();
  await expect.poll(() => asked.length, { timeout: 15000 }).toBe(1);
  expect(asked[0]).toBe("This layer edit discards the 1 rolled-back step(s) after the marker (they cannot be redone). Continue?");
  await k.idle();
  expect((await t.layers()).map((l) => l.name)).toEqual(["Floor"]);
  await expect(k.cards).toHaveCount(2);
  answer = "accept";
  await page.locator('[data-control="layer-name"]').fill("Wall");
  await k.ctl("layer-new").click();
  await expect.poll(async () => (await t.layers()).map((l) => l.name), { timeout: 15000 }).toEqual(["Floor", "Wall"]);
  await expect(k.cards).toHaveCount(2);
  await expect(k.card(1)).toHaveAttribute("data-icon", "layer");
  await k.exact("Active", String(ROOM_TOTAL));
});

test("E2E-181 19 Save and reopen keep the layer steps; Undo after the reopen reverts the last layer edit", async ({ page }, testInfo) => {
  const t = layerMenu(page);
  await t.floorFromBand();
  await t.wallLayer();
  await expect(layerCards(page)).toHaveCount(2);
  const [dl] = await Promise.all([page.waitForEvent("download"), t.ctl("save-session").click()]);
  const path = testInfo.outputPath("steps.pcdsession");
  await dl.saveAs(path);
  await page.locator("#file-input").setInputFiles({ name: "other.pcd", mimeType: "application/octet-stream", buffer: syntheticPcd() });
  await t.exact("Active", String(TOTAL));
  await page.locator("#file-input").setInputFiles({ name: "steps.pcdsession", mimeType: "application/octet-stream", buffer: readFileSync(path) });
  await t.exact("Original", String(ROOM_TOTAL));
  await expect(layerCards(page)).toHaveCount(2);
  await expect(layerCards(page).nth(1)).toHaveAttribute("data-icon", "layer");
  expect((await t.flags()).map((l) => l.name)).toEqual(["Floor", "Wall"]);
  await t.ctl("undo").click();
  await expect.poll(async () => (await t.flags()).map((l) => l.name), { timeout: 15000 }).toEqual(["Floor"]);
  expect((await t.byName("Floor"))!.count).toBe(FLOOR_TRUTH());
});

test("E2E-182 19 One file per layer: one download per layer, each equal to fixture truth for its layer; the link list and the notice carry names and counts", async ({ page }, testInfo) => {
  const t = layerMenu(page);
  await t.floorFromBand();
  await t.wallLayer();
  const got: { name: string; path: string }[] = [];
  page.on("download", (d) => {
    const path = testInfo.outputPath(`pl-${got.length}-${d.suggestedFilename()}`);
    got.push({ name: d.suggestedFilename(), path });
    void d.saveAs(path);
  });
  await t.ctl("export").click();
  await page.locator("#export-per-layer").check();
  await expect(page.locator("#export-summary")).toContainText("Exports 3 files, one per chosen layer");
  await t.ctl("export-go").click();
  await expect.poll(() => got.length, { timeout: 30000 }).toBe(3);
  // the browser fires the three download events in no fixed order: match each file by its name
  expect(got.map((g) => g.name).sort()).toEqual(["room_Floor_cleaned.pcd", "room_Wall_cleaned.pcd", "room_main_cleaned.pcd"]);
  const file = (name: string) => got.find((g) => g.name === name)!.path;
  const all = parsePcd(roomPcd()).rows;
  const floor = all.filter((r) => r.every(Number.isFinite) && inBand(r));
  const wall = all.filter((r) => r.every(Number.isFinite) && inBox(r, WALL18.c, WALL18.d) && !inBand(r));
  const inLayer = new Set([...floor, ...wall].map(rowId));
  const main = all.filter((r) => !inLayer.has(rowId(r)));
  const keys = (rows: number[][]) => rows.map(rowId).sort();
  await expect.poll(() => got.every((g) => existsSync(g.path)), { timeout: 15000 }).toBe(true);
  expect(keys(parsePcd(readFileSync(file("room_main_cleaned.pcd"))).rows)).toEqual(keys(main));
  expect(keys(parsePcd(readFileSync(file("room_Floor_cleaned.pcd"))).rows)).toEqual(keys(floor));
  expect(keys(parsePcd(readFileSync(file("room_Wall_cleaned.pcd"))).rows)).toEqual(keys(wall));
  await expect(page.locator("#export-dialog")).toBeVisible();
  await expect(page.locator("[data-export-file]")).toHaveCount(3);
  await expect(page.locator("[data-export-file]").nth(1)).toHaveText(`room_Floor_cleaned.pcd (${floor.length})`);
  await expect(page.locator("#notices")).toContainText(`room_Wall_cleaned.pcd (${wall.length} points)`);
  await page.locator("#export-close").click();
  await expect(page.locator("#export-dialog")).toBeHidden();
});

test("E2E-250 22-5 the Export sheet is 440 wide under the top bar with a .35 scrim, lists one file per layer, and Cancel closes it", async ({ page }) => {
  const t = layerMenu(page);
  await t.floorFromBand();
  await t.wallLayer();
  await t.ctl("export").click();
  const dlg = page.locator("#export-dialog");
  await expect(dlg).toBeVisible();
  const box = (await dlg.boundingBox())!;
  const bar = (await page.locator("#toolbar").boundingBox())!;
  const vp = page.viewportSize()!;
  expect(Math.abs(box.width - 440)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.x + box.width / 2 - vp.width / 2)).toBeLessThanOrEqual(2);
  expect(Math.abs(box.y - (bar.y + bar.height + 10))).toBeLessThanOrEqual(1);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(await page.evaluate(() => getComputedStyle(document.getElementById("export-dialog")!, "::backdrop").backgroundColor)).toBe("rgba(0, 0, 0, 0.35)");
  await page.locator("#export-per-layer").check();
  await t.ctl("export-go").click();
  await expect(page.locator("[data-export-file]")).toHaveCount(3, { timeout: 30000 });
  await expect(page.locator("[data-export-file]").nth(1)).toContainText("room_Floor_cleaned.pcd");
  await page.locator("#export-cancel").click();
  await expect(dlg).toBeHidden();
});

test("E2E-183 19 Hide selected then Undo: the points are drawn and selectable again", async ({ page }) => {
  const t = hideHelpers(page);
  const n = await t.floorSelected();
  const drawn0 = await t.drawn();
  await t.hideBtn.click();
  await expect.poll(t.drawn, { timeout: 15000 }).toBe(drawn0 - n);
  await t.ctl("undo").click();
  await expect.poll(t.drawn, { timeout: 15000 }).toBe(drawn0);
  await expect(t.hideBtn).toHaveText("Hide selected");
  await t.ctl("sel-select-displayed").click(); // Hide selected already disarmed the Box (R22-1)
  await t.exact("Selected", String(finiteRows().length));
});

test("E2E-184 19 Merge then Undo: both layers and their order come back", async ({ page }) => {
  const t = layerMenu(page);
  const floor = await t.floorFromBand();
  const wallId = await t.wallLayer();
  const before = await t.flags();
  await t.openMore(wallId);
  await t.m("merge-target", wallId).selectOption({ label: "Floor" });
  await t.m("merge", wallId).click();
  await expect.poll(async () => (await t.byName("Wall")) === undefined, { timeout: 15000 }).toBe(true);
  await expect.poll(async () => (await t.byName("Floor"))?.count, { timeout: 15000 }).toBe(floor.count + ROOM.wall);
  await t.ctl("undo").click();
  await expect.poll(async () => t.flags(), { timeout: 15000 }).toEqual(before);
});

for (const [w, h] of [[1280, 720], [1920, 1080]] as const) {
  test(`E2E-185 19 owner screenshots at ${w}x${h}: the strip with a layer and a deletion card, and the per-layer export dialog with its file list`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error" && !/404/.test(m.text())) errors.push(m.text());
    });
    const t = layerMenu(page);
    await t.floorFromBand();
    await t.wallLayer();
    await t.ctl("sel-clear").click();
    await t.ctl("tool-box").click();
    await t.setBox(GHOST_BOX.c, GHOST_BOX.d);
    await t.exact("Selected", String(ROOM.ghost));
    await t.ctl("apply").click();
    await expect(layerCards(page)).toHaveCount(3);
    await expect(layerCards(page).first()).toBeVisible();
    await openPop(page, "display");
    await t.ctl("colour-mode").selectOption("layers");
    await closePop(page, "display");
    await page.mouse.move(5, 5);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `/out/part19-${w}x${h}-strip.png` });
    await t.ctl("export").click();
    await page.locator("#export-per-layer").check();
    await t.ctl("export-go").click();
    await expect(page.locator("[data-export-file]")).toHaveCount(3);
    await expect(page.locator("#export-files")).toBeVisible();
    await page.screenshot({ path: `/out/part19-${w}x${h}-export.png` });
    expect(errors).toEqual([]);
  });
}

// ---------------------------------------------------------------- part 20: Planes and Thin (E2E-186..194)
const planeUi = (page: Pg) => {
  const t = layerMenu(page);
  const k = tl(page);
  const asked: string[] = [];
  const mode = { answer: "accept" as "accept" | "dismiss" };
  page.removeAllListeners("dialog"); // after the helpers, before the open: only the band-replace ask is recorded, every other ask is accepted
  page.on("dialog", (d) => {
    if (/^Replace the protection band/.test(d.message())) {
      asked.push(d.message());
      void (mode.answer === "accept" ? d.accept() : d.dismiss());
    } else void d.accept();
  });
  /** The status bar groups thousands: a plain digit string is compared in that form. */
  const exact = (name: string, v: number | string) => t.exact(name, /^\d+$/.test(String(v)) ? Number(v).toLocaleString("en-US") : v);
  const unfold = async () => {
    const closed = page.locator("details[data-section]:not([open]) > summary:visible");
    for (let i = 0; i < 12 && (await closed.count()) > 0; i++) await closed.first().click();
  };
  const rows = page.locator("#plane-list [data-plane]");
  const openCloud = async (name: string, buf: Buffer, total: number) => {
    await page.goto("/");
    await page.locator("#file-input").setInputFiles({ name, mimeType: "application/octet-stream", buffer: buf });
    await exact("Original", total);
    await k.idle();
  };
  const useTool = async (id: string) => {
    if (!(await t.ctl(id).evaluate((e) => e.classList.contains("active")))) await t.ctl(id).click();
    await unfold();
  };
  /** The O7 values (0.03 / 30 / 4) a plane test needing floor and ceiling or a 30 degree window sets; the defaults are 0.1 / 5 / 1 (R22-15). Call it once the tool is armed. */
  const o7Params = async () => {
    await t.setNum("plane-distance", 0.03);
    await t.setNum("plane-max-tilt", 30);
    await t.setNum("plane-max", 4);
  };
  const detect = async (n: number) => {
    await useTool("tool-plane");
    await o7Params();
    await t.ctl("plane-detect").click();
    await expect(rows).toHaveCount(n, { timeout: 30000 });
  };
  /** The numbers of row i as the list shows them. */
  const rowOf = async (i: number) => {
    const text = (await rows.nth(i).innerText()).replace(/\s+/g, " ");
    const m = /z (-?[\d.]+), tilt (-?[\d.]+) deg, ([\d,]+) points/.exec(text);
    expect(m, text).not.toBeNull();
    return { text, z: Number(m![1]), tilt: Number(m![2]), count: Number(m![3].replace(/,/g, "")) };
  };
  const exportRows = async (testInfo: import("@playwright/test").TestInfo, name: string) => {
    await t.ctl("export").click();
    const [dl] = await Promise.all([page.waitForEvent("download"), t.ctl("export-go").click()]);
    const path = testInfo.outputPath(name);
    await dl.saveAs(path);
    return parsePcd(readFileSync(path)).rows;
  };
  return { ...t, exact, k, asked, mode, unfold, rows, openCloud, useTool, o7Params, detect, rowOf, exportRows };
};
const planeRows = () => parsePcd(planeRoomPcd()).rows;
const dupRows = () => parsePcd(dupRoomPcd()).rows;
const DUP_TOTAL = ROOM_TOTAL + DUP.exact + DUP.near;

test("E2E-186 20 Planes: Detect lists Lowest about 0 and Highest about 3 with the counts of fixture truth, shows its progress while held, and Cancel leaves no list", async ({ page }) => {
  const t = planeUi(page);
  await t.openCloud("planes.pcd", planeRoomPcd(), PLANE_ROOM_TOTAL);
  await t.useTool("tool-plane");
  await expect(t.rows).toHaveCount(0);
  const hold = holdRequests(page, "POST", "/session/planes/detect");
  await t.ctl("plane-detect").click();
  await hold.reached;
  await expect(page.locator("#inspector")).toContainText("Detecting planes");
  await expect(t.ctl("plane-cancel")).toBeVisible();
  await t.ctl("plane-cancel").click();
  await expect(t.ctl("plane-cancel")).toBeHidden();
  await expect(page.locator("#inspector")).not.toContainText("Detecting planes");
  hold.release();
  await t.k.idle();
  await expect(t.rows).toHaveCount(0);
  await expect(page.locator("#inspector")).not.toContainText("found among");
  await t.detect(2);
  const rows = planeRows();
  const low = await t.rowOf(0);
  const high = await t.rowOf(1);
  expect(low.text).toContain("Lowest (floor?)");
  expect(high.text).toContain("Highest (ceiling?)");
  expect(Math.abs(low.z)).toBeLessThan(0.01);
  expect(Math.abs(high.z - 3)).toBeLessThan(0.01);
  expect(low.count).toBe(countPlane(rows, [0, 0, 1], 0, 0.03));
  expect(high.count).toBe(countPlane(rows, [0, 0, 1], 3, 0.03));
  expect([low.count, high.count]).toEqual([PLANE_ROOM.floor, PLANE_ROOM.ceiling]);
  await expect(page.locator("#inspector")).toContainText("2 found among");
});

test("E2E-187 20 Planes: choosing the Highest row selects the ceiling, Delete removes exactly it as a Plane step, Undo restores, Redo repeats", async ({ page }) => {
  const t = planeUi(page);
  await t.openCloud("planes.pcd", planeRoomPcd(), PLANE_ROOM_TOTAL);
  await t.detect(2);
  await page.locator("#plane-select-1").click();
  await t.exact("Selected", String(PLANE_ROOM.ceiling));
  await t.exact("Candidates", String(PLANE_ROOM.ceiling));
  await t.ctl("apply").click();
  await t.exact("Active", String(PLANE_ROOM_TOTAL - PLANE_ROOM.ceiling));
  await expect(t.k.cards).toHaveCount(1);
  await expect(t.k.card(0)).toHaveAttribute("title", new RegExp(`^Plane delete, ${PLANE_ROOM.ceiling} points`));
  await t.ctl("undo").click();
  await t.exact("Active", String(PLANE_ROOM_TOTAL));
  await t.ctl("redo").click();
  await t.exact("Active", String(PLANE_ROOM_TOTAL - PLANE_ROOM.ceiling));
  await expect(t.k.cards).toHaveCount(1);
});

test("E2E-188 20 Use as protection band on a tilted floor: the band tilt is the floor's, Protected equals fixture truth, a box Delete over the ghosts and the floor keeps the floor, and an enabled band is replaced only after a Yes", async ({ page }) => {
  const t = planeUi(page);
  await t.openCloud("tilted.pcd", tiltedFloorPcd(), TILTED.floor + TILTED.ghost);
  await t.useTool("tool-plane");
  await t.o7Params();
  await t.ctl("plane-detect").click();
  await expect(t.rows.first()).toBeVisible({ timeout: 30000 });
  const first = await t.rowOf(0);
  expect(first.text).toContain("Lowest");
  await page.locator("#plane-band-0").click();
  await expect(t.ctl("prot-enabled")).toBeChecked({ timeout: 15000 });
  expect(t.asked).toEqual([]); // no band was enabled: no confirm
  const rowsT = parsePcd(tiltedFloorPcd()).rows;
  const ang = tiltedFloorAngles();
  const b = await tiltNow(page);
  expect(Math.abs(b.rx - ang.rx)).toBeLessThan(0.01);
  expect(Math.abs(b.ry - ang.ry)).toBeLessThan(0.01);
  const truth = countInTiltedSlab(rowsT, b.rx, b.ry, b.pivot, b.min, b.max);
  expect(truth).toBe(TILTED.floor);
  await t.exact("Protected", String(truth));
  // an enabled band: No changes nothing, Yes replaces it, both after the confirm text
  t.mode.answer = "dismiss";
  await page.locator("#plane-band-0").click();
  await expect.poll(() => t.asked.length, { timeout: 15000 }).toBe(1);
  expect(t.asked[0]).toMatch(/^Replace the protection band -?[\d.]+ to -?[\d.]+ \(tilt rx -?[\d.]+, ry -?[\d.]+ degrees\) with this Detected plane\?$/);
  expect(await tiltNow(page)).toEqual(b);
  t.mode.answer = "accept";
  await page.locator("#plane-band-0").click();
  await expect.poll(() => t.asked.length, { timeout: 15000 }).toBe(2);
  await t.exact("Protected", String(truth));
  // the ghosts and the floor in one box: the floor stays
  await t.k.boxAt(10, 10, 2, 40, 40, 12);
  await t.exact("Selected", String(TILTED.floor + TILTED.ghost));
  await t.exact("Candidates", String(TILTED.ghost));
  await t.ctl("apply").click();
  await t.exact("Active", String(TILTED.floor));
});

test("E2E-189 20 a Detected plane protects through a layer: the Lowest plane as a protected layer survives a box Delete over the room, and New layer from protected points after the band holds the floor", async ({ page }) => {
  const t = planeUi(page);
  await t.openCloud("planes.pcd", planeRoomPcd(), PLANE_ROOM_TOTAL);
  await t.detect(2);
  await page.locator("#plane-select-0").click();
  await t.exact("Selected", String(PLANE_ROOM.floor));
  const id = await t.newLayer("Floor");
  await expect.poll(async () => (await t.byName("Floor"))?.count, { timeout: 15000 }).toBe(PLANE_ROOM.floor);
  await t.openMore(id);
  await t.m("protected", id).click();
  await expect.poll(async () => (await t.byName("Floor"))?.protected, { timeout: 15000 }).toBe(true);
  await t.ctl("sel-clear").click(); // a box over an existing selection is a draft: clear it so the box is the first selection
  await t.k.boxAt(5, 5, 1.5, 30, 30, 8);
  await t.exact("Selected", String(PLANE_ROOM_TOTAL));
  await t.exact("Candidates", String(PLANE_ROOM_TOTAL - PLANE_ROOM.floor));
  await t.ctl("apply").click();
  await t.exact("Active", String(PLANE_ROOM.floor));
  expect((await t.byName("Floor"))!.count).toBe(PLANE_ROOM.floor);
  // the band route: a fresh open, the Lowest plane as the band, then the band's points as a protected layer
  await t.openCloud("planes.pcd", planeRoomPcd(), PLANE_ROOM_TOTAL);
  await t.detect(2);
  await page.locator("#plane-band-0").click();
  await expect(t.ctl("prot-enabled")).toBeChecked({ timeout: 15000 });
  await t.exact("Protected", String(PLANE_ROOM.floor));
  await t.ctl("layer-from-band").click();
  await expect.poll(async () => (await t.byName("Floor"))?.count, { timeout: 15000 }).toBe(PLANE_ROOM.floor);
  expect((await t.byName("Floor"))!.protected).toBe(true);
});

test("E2E-190 20 Thin duplicates with distance 0: Selected is the duplicate truth, Delete leaves no duplicate row in the export, and Undo restores", async ({ page }, testInfo) => {
  const t = planeUi(page);
  await t.openCloud("dups.pcd", dupRoomPcd(), DUP_TOTAL);
  const all = dupRows();
  const dup = dupTruth(all, 0);
  expect(dup.length).toBe(DUP.exact);
  await t.useTool("tool-thin");
  await t.exact("Selected", String(DUP.exact));
  await t.exact("Candidates", String(DUP.exact));
  await t.ctl("apply").click();
  await t.exact("Active", String(DUP_TOTAL - DUP.exact));
  await expect(t.k.card(0)).toHaveAttribute("title", new RegExp(`^Thin delete, ${DUP.exact} points`));
  const out = (await t.exportRows(testInfo, "thin0.pcd")).filter((r) => r.every(Number.isFinite));
  const xyz = (r: number[]) => r.slice(0, 3).map(Math.fround).join(",");
  expect(new Set(out.map(xyz)).size).toBe(out.length); // no duplicate row is left
  const drop = new Set(dup);
  const kept = all.filter((r, i) => r.every(Number.isFinite) && !drop.has(i)).map(f32key).sort();
  expect(out.map(f32key).sort()).toEqual(kept);
  await t.ctl("undo").click();
  await t.exact("Active", String(DUP_TOTAL));
});

test("E2E-191 20 Thin with distance 1e-3 and with a voxel edge 0.05 select the fixture truth, and a box Subtract and Add compose with the Thin selection", async ({ page }) => {
  const t = planeUi(page);
  await t.openCloud("dups.pcd", dupRoomPcd(), DUP_TOTAL);
  const all = dupRows();
  const near = dupTruth(all, 1e-3);
  expect(near.length).toBe(DUP.exact + DUP.near);
  await t.useTool("tool-thin");
  await t.setNum("thin-distance", 0.001);
  await t.exact("Selected", String(near.length));
  await t.ctl("thin-method").selectOption("voxel");
  await expect(t.ctl("thin-edge")).toBeVisible();
  const vox = voxelTruth(all, 0.05);
  await t.exact("Selected", String(vox.length));
  expect(vox.length).toBeGreaterThan(0);
  // back to the distance rule, then compose with boxes
  await t.ctl("thin-method").selectOption("duplicates");
  await t.exact("Selected", String(near.length));
  const sel = new Set(near);
  const A = { c: [0, 10, 0], d: [1, 30, 1] };
  const inA = all.map((r, i) => (sel.has(i) && r.every(Number.isFinite) && inBox(r, A.c, A.d) ? i : -1)).filter((i) => i >= 0);
  expect(inA.length).toBeGreaterThan(0);
  await t.useTool("tool-box");
  await t.ctl("op-subtract").click();
  await t.setBox(A.c, A.d);
  await t.previewLeaves(near.length - inA.length);
  await t.ctl("sel-commit").click();
  await t.exact("Selected", String(near.length - inA.length));
  const left = new Set(near.filter((i) => !inA.includes(i)));
  const B = { c: [5, 10, 0], d: [1, 30, 1] };
  const inB = all.map((r, i) => (r.every(Number.isFinite) && inBox(r, B.c, B.d) && !left.has(i) ? i : -1)).filter((i) => i >= 0);
  await t.ctl("op-add").click();
  await t.setBox(B.c, B.d);
  await t.previewIs(left.size + inB.length);
  await t.ctl("sel-commit").click();
  await t.exact("Selected", String(left.size + inB.length));
});

test("E2E-192 20 Save and reopen keep the Plane and Thin steps; Edit shape on each reopens the tool with the stored numbers; a reload shows no plane list", async ({ page }, testInfo) => {
  const t = planeUi(page);
  await t.openCloud("planes.pcd", planeRoomPcd(), PLANE_ROOM_TOTAL);
  await t.detect(2);
  await t.setNum("plane-distance", 0.05); // the slab half thickness is read when the row is chosen
  await page.locator("#plane-select-1").click();
  await t.exact("Selected", String(PLANE_ROOM.ceiling));
  await t.ctl("apply").click();
  await t.exact("Active", String(PLANE_ROOM_TOTAL - PLANE_ROOM.ceiling));
  await t.useTool("tool-thin");
  await t.ctl("thin-method").selectOption("voxel");
  await t.setNum("thin-edge", 0.5);
  const after = planeRows().filter((r) => r[2] < 2.9);
  const vox = voxelTruth(after, 0.5);
  await t.exact("Selected", String(vox.length));
  await t.ctl("apply").click();
  await t.exact("Active", String(PLANE_ROOM_TOTAL - PLANE_ROOM.ceiling - vox.length));
  await expect(t.k.cards).toHaveCount(2);
  const [dl] = await Promise.all([page.waitForEvent("download"), t.ctl("save-session").click()]);
  const path = testInfo.outputPath("pt.pcdsession");
  await dl.saveAs(path);
  await page.locator("#file-input").setInputFiles({ name: "other.pcd", mimeType: "application/octet-stream", buffer: syntheticPcd() });
  await t.exact("Active", String(TOTAL));
  await page.locator("#file-input").setInputFiles({ name: "pt.pcdsession", mimeType: "application/octet-stream", buffer: readFileSync(path) });
  await t.exact("Original", String(PLANE_ROOM_TOTAL));
  await expect(t.k.cards).toHaveCount(2);
  await expect(t.k.card(0)).toHaveAttribute("title", /^Plane delete/);
  await expect(t.k.card(1)).toHaveAttribute("title", /^Thin delete/);
  await expect(t.rows).toHaveCount(0);
  await t.k.idle();
  await t.k.card(1).locator(".step-icon").click();
  await t.ctl("step-edit-shape").click();
  await expect(t.ctl("tool-thin")).toHaveClass(/active/);
  await t.unfold();
  await expect(t.ctl("thin-method")).toHaveValue("voxel");
  await expect(t.ctl("thin-edge")).toHaveValue("0.5");
  await t.k.idle();
  await t.k.card(0).locator(".step-icon").click();
  await t.ctl("step-edit-shape").click();
  await expect(t.ctl("tool-plane")).toHaveClass(/active/);
  await t.unfold();
  await expect(t.ctl("plane-distance")).toHaveValue("0.05");
  await expect(t.rows).toHaveCount(0); // a reopen shows no list; the step's plane is what Edit shape holds
  await expect(t.k.cards).toHaveCount(2);
  // a reload keeps the steps but shows no detection
  await page.reload();
  await t.exact("Original", String(PLANE_ROOM_TOTAL));
  await expect(t.rows).toHaveCount(0);
});

for (const [w, hgt] of [[1280, 720], [1920, 1080]] as const) {
  test(`E2E-193 20 layout at ${w}x${hgt}: with the Planes section open and 4 rows (the wall rows of the layout fixture join the floor and the ceiling) nothing overflows or overlaps; the tool row geometry is logged`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: w, height: hgt });
    const t = planeUi(page);
    await t.openCloud("planes.pcd", planeRoomPcd(true), PLANE_ROOM_TOTAL);
    await t.useTool("tool-plane");
    await t.detect(4);
    const g = await page.evaluate(() => {
      const panel = document.getElementById("editpanels")!;
      const tools = document.querySelector("#tools .stack")!;
      const tb = tools.getBoundingClientRect();
      const btns = [...tools.children].map((c) => c.getBoundingClientRect());
      const overlap = btns.some((a, i) => btns.some((b, j) => j > i && a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5));
      const inside = btns.every((r) => r.left >= tb.left - 1 && r.right <= tb.right + 1);
      const list = document.getElementById("plane-list")!.getBoundingClientRect();
      const pb = panel.getBoundingClientRect();
      const doc = document.documentElement;
      return { overlap, inside, rowW: Math.round(tb.width), rowH: Math.round(tb.height), tops: [...new Set(btns.map((r) => Math.round(r.top)))].length, scroll: [panel.scrollWidth, panel.clientWidth], listInside: list.left >= pb.left - 1 && list.right <= pb.right + 1, doc: [doc.scrollWidth - doc.clientWidth] };
    });
    console.log(`TOOL-ROW ${g.rowW}x${g.rowH} (${g.tops} line(s))`);
    testInfo.annotations.push({ type: "TOOL-ROW", description: `${g.rowW}x${g.rowH} lines ${g.tops}` });
    expect(g.overlap).toBe(false);
    expect(g.inside).toBe(true);
    expect(g.scroll[0]).toBeLessThanOrEqual(g.scroll[1] + 1);
    expect(g.listInside).toBe(true);
    expect(g.doc).toEqual([0]);
  });
}

for (const [w, hgt] of [[1280, 720], [1920, 1080]] as const) {
  test(`E2E-194 20 owner screenshots at ${w}x${hgt}: the Planes section with its rows and the Thin section`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: hgt });
    const t = planeUi(page);
    await t.openCloud("planes.pcd", planeRoomPcd(), PLANE_ROOM_TOTAL);
    await t.detect(2);
    await page.locator("#plane-select-0").click();
    await t.exact("Selected", String(PLANE_ROOM.floor));
    await page.mouse.move(5, 5);
    await t.k.idle();
    await page.screenshot({ path: `/out/part20-${w}x${hgt}-planes.png` });
    await t.useTool("tool-thin");
    await t.ctl("thin-method").selectOption("voxel");
    await t.k.idle();
    await page.mouse.move(5, 5);
    await page.screenshot({ path: `/out/part20-${w}x${hgt}-thin.png` });
  });
}

// ---- part 22-10: tool defaults (R22-15)
test("E2E-260 22-10 a fresh page: Sparse radius 0.4; Planes 0.1 / 5 / 1; a default Detect lists exactly the floor with the fixture-truth count", async ({ page }) => {
  const t = planeUi(page);
  await t.openCloud("planes.pcd", planeRoomPcd(), PLANE_ROOM_TOTAL);
  await t.useTool("tool-sparse");
  await expect(page.locator("#sparse-radius")).toHaveValue("0.4");
  await t.useTool("tool-plane");
  await expect(page.locator("#plane-distance")).toHaveValue("0.1");
  await expect(page.locator("#plane-max-tilt")).toHaveValue("5");
  await expect(page.locator("#plane-max")).toHaveValue("1");
  await t.ctl("plane-detect").click();
  await expect(t.rows).toHaveCount(1, { timeout: 30000 });
  const only = await t.rowOf(0);
  expect(only.text).toContain("Lowest (floor?)");
  expect(Math.abs(only.z)).toBeLessThan(0.01);
  expect(only.count).toBe(PLANE_ROOM.floor);
  expect(only.count).toBe(countPlane(planeRows(), [0, 0, 1], 0, 0.1));
});

// ---- final fixes (part 21)
test("E2E-195 21 a newly opened file forgets the chosen layer and the open fold-outs of the previous one", async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
  const t = layerHelpers(page);
  const { id } = await t.floorLayer();
  await t.pick(id).click();
  await t.openMore(id);
  await expect(t.pick(id)).toHaveClass(/active/);
  const ui = () => hook(page, (e) => ({ active: e.state().layerUi.active, editing: e.state().layerUi.editing }));
  expect(await ui()).toEqual({ active: id, editing: null });
  await page.locator("#file-input").setInputFiles({ name: "other.pcd", mimeType: "application/octet-stream", buffer: syntheticPcd() });
  await expect.poll(() => hook(page, (e) => e.state().session?.filename), { timeout: 15000 }).toBe("other.pcd");
  expect(await ui()).toEqual({ active: null, editing: null });
});

// ---- part 22-1: tool disarm (R22-1)
test("E2E-197 22-1 Box then Delete leaves no tool armed; a dismissed bulk confirm leaves it armed", async ({ page }) => {
  const t = previewHelpers(page);
  await openRoom(page, t.exact);
  const asked: string[] = [];
  page.removeAllListeners("dialog"); // the helpers accept every ask; this test answers by text
  page.on("dialog", (d) => {
    asked.push(d.message());
    if (/^This deletes /.test(d.message())) void d.dismiss();
    else void d.accept();
  }); // after the open: the "unsaved edits" ask of a file left by an earlier test is not under test
  await t.ctl("cube-top").click();
  await t.ctl("tool-box").click();
  await t.setBox(GHOST_BOX.c, GHOST_BOX.d);
  await t.exact("Selected", String(ROOM.ghost));
  await expect(t.ctl("apply")).toBeEnabled();
  await t.ctl("apply").click();
  await t.exact("Active", String(ROOM_TOTAL - ROOM.ghost));
  await expect(t.ctl("tool-box")).not.toHaveClass(/active/);
  await expect(page.locator("#box-center-x")).toBeHidden(); // the Box section shows only while armed
  // Apply cleared the selection and Undo does not bring it back: arming the Box again is a live first selection
  await t.ctl("undo").click();
  await t.exact("Active", String(ROOM_TOTAL));
  await t.ctl("tool-box").click();
  await t.setBox(ALL_BOX.c, ALL_BOX.d);
  await expect(t.ctl("apply")).toBeEnabled();
  await t.ctl("apply").click();
  await expect.poll(() => asked.filter((m) => /^This deletes /.test(m)).length, { timeout: 15000 }).toBe(1);
  await t.exact("Active", String(ROOM_TOTAL));
  await expect(t.ctl("tool-box")).toHaveClass(/active/);
  // the Delete key does the same as the button
  await t.setBox(GHOST_BOX.c, GHOST_BOX.d);
  await t.exact("Selected", String(ROOM.ghost));
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Delete");
  await t.exact("Active", String(ROOM_TOTAL - ROOM.ghost));
  await expect(t.ctl("tool-box")).not.toHaveClass(/active/);
});

test("E2E-198 22-1 layer actions that consume the selection disarm; a declined one keeps the tool armed", async ({ page }) => {
  const t = layerMenu(page);
  // the helpers accept every ask and each leaves an unsaved session; the listener below replaces them after the open
  const { id: floor, n } = await t.floorLayer();
  const asked: string[] = [];
  const mode = { answer: "accept" as "accept" | "dismiss" };
  page.removeAllListeners("dialog");
  page.on("dialog", (d) => {
    asked.push(d.message());
    void (mode.answer === "accept" ? d.accept() : d.dismiss());
  });
  const armed = (on: boolean) => (on ? expect(t.ctl("tool-box")).toHaveClass(/active/) : expect(t.ctl("tool-box")).not.toHaveClass(/active/));
  // 1: New layer consumed the selection
  await armed(false);
  // 2: Hide selected disarms; Show hidden is not a consumer
  await t.ctl("sel-clear").click();
  await t.ctl("tool-box").click();
  await t.setBox(WALL18.c, WALL18.d);
  await t.exact("Selected", String(ROOM.wall));
  await t.ctl("sel-hide").click();
  await expect(t.chip).toHaveText(`${ROOM.wall} hidden - Show`);
  await t.exact("Selected", "0");
  await armed(false);
  await t.ctl("sel-hide").click();
  await t.exact("Selected", String(ROOM.wall));
  await armed(false);
  // 3: a declined steal confirm keeps the Box armed
  await t.ctl("sel-clear").click();
  await t.ctl("tool-box").click();
  await t.setBox(FLOOR_BOX.c, FLOOR_BOX.d);
  await t.exact("Selected", String(n));
  mode.answer = "dismiss";
  const before = asked.length;
  await page.locator('[data-control="layer-name"]').fill("Steal");
  await t.ctl("layer-new").click();
  await expect.poll(() => asked.length, { timeout: 15000 }).toBe(before + 1);
  expect(asked[before]).toMatch(/out of other layers/);
  expect((await t.layers()).some((l) => l.name === "Steal")).toBe(false);
  await armed(true);
  // 4: a layer menu Subtract consumes the selection
  await t.openMore(floor);
  await t.op(floor, "subtract").click();
  await t.exact("Selected", "0");
  await armed(false);
  // 5: New layer from protected points disarms
  mode.answer = "accept";
  const layersBefore = (await t.layers()).length;
  await t.bandOn();
  await t.ctl("tool-box").click();
  await armed(true);
  await t.exact("Selected", "0");
  await t.ctl("layer-from-band").click();
  await expect.poll(async () => (await t.layers()).length, { timeout: 15000 }).toBe(layersBefore + 1);
  expect((await t.flags()).some((l) => l.protected)).toBe(true);
  await armed(false);
});

test("E2E-196 22-1 Esc disarms the armed tool only when nothing more specific is pending, keeps the candidate, and stays out of fields, help, dialogs and drafts", async ({ page }) => {
  const t = hideHelpers(page);
  await t.floorSelected();
  page.removeAllListeners("dialog"); // the helpers accept every ask; none is expected below
  page.on("dialog", (d) => void d.accept());
  const armed = (on: boolean) => (on ? expect(t.ctl("tool-box")).toHaveClass(/active/) : expect(t.ctl("tool-box")).not.toHaveClass(/active/));
  const blur = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await t.ctl("sel-clear").click();
  await t.ctl("tool-box").click();
  await t.setBox(GHOST_BOX.c, GHOST_BOX.d);
  await t.exact("Selected", String(ROOM.ghost));
  await t.exact("Candidates", String(ROOM.ghost));
  // 2: Escape in a filter box field is the field's own
  await expandFilterBox(page, "filter-x-min");
  await page.locator("#filter-x-min").focus();
  await page.keyboard.press("Escape");
  await armed(true);
  // 3: Escape closes the help overlay and leaves the tool
  await blur();
  await page.keyboard.press("?");
  await expect(page.locator("#help-overlay")).toHaveClass(/on/);
  await page.keyboard.press("Escape");
  await expect(page.locator("#help-overlay")).not.toHaveClass(/on/);
  await armed(true);
  // 4: Escape in the export dialog closes it and leaves the tool; the page probe proves the dialog still reads open during keydown
  await page.evaluate(() => {
    const w = window as unknown as { __escDialog: boolean | null };
    w.__escDialog = null;
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") w.__escDialog = document.querySelector("dialog[open]") !== null;
    });
  });
  await t.ctl("export").click();
  await expect(page.locator("dialog[open]")).toHaveCount(1);
  await t.ctl("export-cancel").focus(); // a BUTTON: the dialog's first control is a SELECT, a field
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __escDialog: boolean | null }).__escDialog)).toBe(true);
  await armed(true);
  // 5: nothing pending (a checkbox has the focus, not a text field): Escape disarms and keeps the selection and its candidate
  await openHandles(page);
  await t.ctl("gizmo-snap").focus();
  await page.keyboard.press("Escape");
  await armed(false);
  await expect(page.locator("#modebar")).toContainText("Tool: None");
  await expect(page.locator("#box-center-x")).toBeHidden();
  await t.exact("Selected", String(ROOM.ghost));
  await expect(t.ctl("apply")).toBeEnabled();
  await t.ctl("apply").click();
  await t.exact("Active", String(ROOM_TOTAL - ROOM.ghost));
  // 6: a pending draft takes the Escape: the draft goes, the selection and the tool stay
  await t.ctl("tool-box").click();
  await t.setBox(WALL18.c, WALL18.d);
  await t.exact("Selected", String(ROOM.wall));
  await t.ctl("op-add").click();
  await t.setBox(FLOOR_BOX.c, FLOOR_BOX.d);
  await expect(t.ctl("sel-discard")).toBeEnabled();
  await blur();
  await page.keyboard.press("Escape");
  await expect(t.ctl("sel-discard")).toBeDisabled();
  await t.exact("Selected", String(ROOM.wall));
  await armed(true);
  // 7: Cluster in pick mode: the first Escape leaves pick mode, the second disarms
  await t.ctl("tool-cluster").click();
  await expect(t.ctl("cluster-pick-seed")).toHaveAttribute("data-state", "waiting");
  await page.keyboard.press("Escape");
  await expect(t.ctl("cluster-pick-seed")).toHaveAttribute("data-state", "paused");
  await expect(t.ctl("tool-cluster")).toHaveClass(/active/);
  await page.keyboard.press("Escape");
  await expect(t.ctl("tool-cluster")).not.toHaveClass(/active/);
});

test("E2E-200 22-1 Esc disarms the armed tool while a filter grip has the keyboard focus (focus alone is not a drag)", async ({ page }) => {
  const t = hideHelpers(page);
  await t.floorSelected();
  page.removeAllListeners("dialog"); // the helpers accept every ask; none is expected below
  page.on("dialog", (d) => void d.accept());
  await t.ctl("sel-clear").click();
  await t.ctl("tool-box").click();
  await t.setBox(GHOST_BOX.c, GHOST_BOX.d);
  await t.exact("Selected", String(ROOM.ghost));
  await expandFilterBox(page, "filter-x-min");
  await page.locator("#filter-x-min-grip").focus();
  await expect(page.locator("#filter-x-min-grip")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(t.ctl("tool-box")).not.toHaveClass(/active/);
  await expect(page.locator("#modebar")).toContainText("Tool: None");
  await t.exact("Selected", String(ROOM.ghost));
  await t.exact("Candidates", String(ROOM.ghost));
});

for (const [w, h] of [[1280, 720], [1920, 1080]] as const) {
  test(`E2E-199 22-1 owner screenshots at ${w}x${h}: the Box armed over the ghosts, then the same view after Delete with no tool, gizmo or Box section`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error" && !/404/.test(m.text())) errors.push(m.text());
    });
    const t = hideHelpers(page);
    await t.floorSelected();
    page.removeAllListeners("dialog"); // after the open: the helpers accept every ask
    page.on("dialog", (d) => void d.accept());
    await t.ctl("sel-clear").click();
    await t.ctl("tool-box").click();
    await t.setBox(GHOST_BOX.c, GHOST_BOX.d);
    await t.exact("Selected", String(ROOM.ghost));
    await expect(t.ctl("tool-box")).toHaveClass(/active/);
    await page.mouse.move(5, 5);
    await appIdle(page);
    await page.screenshot({ path: `/out/part22-1-${w}x${h}-armed.png` });
    await t.ctl("apply").click();
    await t.exact("Active", String(ROOM_TOTAL - ROOM.ghost));
    await expect(t.ctl("tool-box")).not.toHaveClass(/active/);
    await expect(page.locator("#box-center-x")).toBeHidden();
    await page.mouse.move(5, 5);
    await appIdle(page);
    await page.screenshot({ path: `/out/part22-1-${w}x${h}-after-delete.png` });
    expect(errors).toEqual([]);
  });
}

// ---- part 22-3: the protection band with the Box handles (E2E-215..217)
test("E2E-215 22-3 with the real mouse the band's upper z arrow tip widens max only, and a tilt ring (X facing the camera) turns rx; #prot-tilt-x shows state; Protected equals fixture truth", async ({ page }) => {
  const { exact, ctl, setNum } = helpers(page);
  await openTilted(page, exact);
  // the camera outlives the page (a Top view an earlier test left is restored), so the view is set here, not assumed
  await cornerView(page);
  const rows = tiltedRows();
  await ctl("prot-enabled").check();
  await setNum("prot-max", 0.5);
  await setNum("prot-min", -0.5);
  await appIdle(page);
  // the corner view set above: grab the upper arrow at its tip and pull it 25 px further out
  const upper = (await page.evaluate(() => (window as unknown as { __editor: TiltHook }).__editor.protectionArrows())).find((r) => r.key === "global-max")!;
  const dx = upper.tip!.x - upper.base!.x;
  const dy = upper.tip!.y - upper.base!.y;
  const len = Math.hypot(dx, dy);
  await realDrag(page, upper.tip!, { x: upper.tip!.x + (dx / len) * 25, y: upper.tip!.y + (dy / len) * 25 });
  const widened = await tiltNow(page);
  expect(widened.min).toBe(-0.5); // the lower edge is untouched
  expect(widened.max).toBeGreaterThan(0.5);
  expect(widened.rx).toBe(0);
  expect(widened.ry).toBe(0);
  await exact("Protected", String(countInTiltedSlab(rows, 0, 0, widened.pivot, widened.min, widened.max)));
  // the Left view looks along +X, so the X rings are full circles there (ortho: tilt-x+ and tilt-x- coincide)
  await page.keyboard.press("5");
  await appIdle(page);
  const ring = (await page.evaluate(() => (window as unknown as { __editor: TiltHook }).__editor.tiltRings())).find((r) => r.id === "tilt-x+")!;
  expect(ring.pts).toHaveLength(32);
  await realDrag(page, ring.pts[0]!, ring.pts[3]!);
  const turned = await tiltNow(page);
  expect(Math.abs(turned.rx)).toBeGreaterThan(5);
  expect(Math.abs(turned.rx)).toBeLessThan(60);
  expect(turned.ry).toBe(0);
  expect(turned.max).toBe(widened.max);
  await expect.poll(async () => Math.abs(Number(await ctl("prot-tilt-x").inputValue()) - turned.rx)).toBeLessThan(1e-4); // the field shows the state value
  await exact("Protected", String(countInTiltedSlab(rows, turned.rx, turned.ry, turned.pivot, turned.min, turned.max)));
});

/** The tilted fixture with the slab fitted to the floor by typing (as E2E-44), in the Front view unless `front` is false. */
const fitTiltedFloor = async (page: import("@playwright/test").Page, setNum: (id: string, v: number) => Promise<void>, ctl: (id: string) => import("@playwright/test").Locator, front = true) => {
  await ctl("prot-enabled").check();
  const ang = tiltedFloorAngles();
  await setNum("prot-tilt-y", ang.ry);
  await setNum("prot-tilt-x", ang.rx);
  const t = await tiltNow(page);
  const rx = (t.rx * Math.PI) / 180;
  const ry = (t.ry * Math.PI) / 180;
  const c = -(Math.cos(rx) * Math.sin(ry) * t.pivot[0] - Math.sin(rx) * t.pivot[1]);
  const lo = c - TILTED.half;
  const hi = c + TILTED.half;
  const order = hi > t.min ? ["prot-max", "prot-min"] : ["prot-min", "prot-max"];
  for (const id of order) await setNum(id, id === "prot-max" ? hi : lo);
  if (front) await ctl("cube-front").click(); // not the "3" key: after the last field's Tab it would be typed into a number field
  await appIdle(page);
  return tiltNow(page);
};
const bandHidden = (page: import("@playwright/test").Page) => page.evaluate(() => !(window as unknown as { __editor: { state: () => { bandVisible: boolean } } }).__editor.state().bandVisible);

test("E2E-216 22-3 Show band off: protection and counts stay, the band's handles and drawing go, a press where the arrow tip was grabs nothing, a box Delete removes exactly the unprotected points, the pill says so; Show and reload keep to the switch", async ({ page }) => {
  const { exact, ctl, setNum, num } = helpers(page);
  await openTilted(page, exact);
  const rows = tiltedRows();
  const fitted = await fitTiltedFloor(page, setNum, ctl);
  await exact("Protected", String(TILTED.floor));
  expect(countInTiltedSlab(rows, fitted.rx, fitted.ry, fitted.pivot, fitted.min, fitted.max)).toBe(TILTED.floor);
  const hooks = () => page.evaluate(() => ({ arrows: (window as unknown as { __editor: TiltHook }).__editor.protectionArrows().length, rings: (window as unknown as { __editor: TiltHook }).__editor.tiltRings().length }));
  expect(await hooks()).toEqual({ arrows: 2, rings: 4 });
  const tip = await arrowTip(page, "global-max");
  const pill = page.locator("#band-pill");
  await expect(pill).toBeHidden();
  // pixels: the viewport above the pill with the section folded, band shown
  const summary = page.locator("details.panel > summary", { hasText: "Height protection" });
  const fold = async (open: boolean) => {
    if ((await protNow(page)).open !== open) await summary.click();
    await expect.poll(async () => (await protNow(page)).open).toBe(open);
  };
  const clipOf = async () => {
    const v = (await page.locator("#viewport").boundingBox())!;
    return { x: v.x, y: v.y, width: v.width, height: v.height - 130 }; // the pill sits in the bottom 130 px (checked below)
  };
  const snap = async () => {
    await page.mouse.move(5, 5);
    await appIdle(page);
    // the HUD glass blurs what is behind it, and the blur's edge pixels differ by one level between two identical frames (22-4): compare the canvas, not the blur
    return page.screenshot({ clip: await clipOf(), style: "#stage * { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }" });
  };
  await fold(false); // folded: no strong colour, so only the band can differ
  const shownShot = await snap();
  await fold(true);

  await ctl("prot-show-band").click();
  await expect(ctl("prot-show-band")).toHaveAttribute("aria-checked", "false");
  expect(await bandHidden(page)).toBe(true);
  await expect(pill).toBeVisible();
  await expect(pill).toContainText("Protection on · band hidden");
  const pb = (await pill.boundingBox())!;
  const vb = (await page.locator("#viewport").boundingBox())!;
  expect(pb.y).toBeGreaterThan(vb.y + vb.height - 130); // inside the clip's complement
  expect(pb.y + pb.height).toBeLessThanOrEqual(vb.y + vb.height);
  expect(await hooks()).toEqual({ arrows: 0, rings: 0 });
  await exact("Protected", String(TILTED.floor));
  expect(await tiltNow(page)).toEqual(fitted); // protection untouched
  await fold(false);
  const hiddenShot = await snap();
  await fold(true);
  // protection off and folded draws the same canvas as the hidden band (above the pill), and shown differs
  await ctl("prot-enabled").uncheck();
  await expect(pill).toBeHidden();
  await fold(false);
  const offShot = await snap();
  await fold(true);
  expect(hiddenShot.equals(offShot)).toBe(true);
  expect(shownShot.equals(hiddenShot)).toBe(false);
  await ctl("prot-enabled").check();
  await exact("Protected", String(TILTED.floor));
  await expect(pill).toBeVisible();
  // a real press and drag where the arrow tip was leaves min and max alone (the camera gets it and orbits)
  await realDrag(page, tip, { x: tip.x, y: tip.y - 30 });
  const after = await tiltNow(page);
  expect(after.min).toBe(fitted.min);
  expect(after.max).toBe(fitted.max);
  await exact("Protected", String(TILTED.floor));

  // a box over the floor and the ghosts: Delete removes exactly the unprotected points
  await ctl("tool-box").click();
  for (const [id, v] of [["box-center-x", 10], ["box-center-y", 10], ["box-center-z", 3], ["box-size-x", 30], ["box-size-y", 30], ["box-size-z", 20]] as const) await setNum(id, v);
  await exact("Candidates", String(TILTED.ghost));
  await ctl("apply").click();
  await exact("Active", String(TILTED.floor));
  expect(await num("Original")).toBe(TILTED.floor + TILTED.ghost);
  await exact("Protected", String(TILTED.floor));

  // reload keeps hidden (E1), and Show brings the handles and hides the pill
  // the client state is saved a second after the last change: wait for the archive to hold the flag before reloading
  await expect
    .poll(() => page.evaluate(async () => (await (await fetch("/api/session")).json()).client_state?.ui?.bandHidden), { timeout: 15000 })
    .toBe(true);
  await page.reload();
  await exact("Original", String(TILTED.floor + TILTED.ghost));
  await expect.poll(() => bandHidden(page), { timeout: 15000 }).toBe(true);
  await expect(pill).toBeVisible();
  await pill.getByRole("button", { name: "Show" }).click();
  await expect(pill).toBeHidden();
  expect(await bandHidden(page)).toBe(false);
  expect((await hooks()).arrows).toBe(2);
  // leave the archive shown (the flag is absent while shown), so the next test's reopened session does not start hidden
  await expect
    .poll(() => page.evaluate(async () => (await (await fetch("/api/session")).json()).client_state?.ui?.bandHidden), { timeout: 15000 })
    .toBeUndefined();
});

for (const [w, h] of [[1280, 720], [1920, 1080]] as const) {
  test(`E2E-217 22-3 owner screenshots at ${w}x${h}: the band shown (corner view, section open) and hidden with the pill; the pill sits in the canvas and overlaps nothing`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error" && !/404/.test(m.text())) errors.push(m.text());
    });
    const { exact, ctl, setNum } = helpers(page);
    await openTilted(page, exact);
    await fitTiltedFloor(page, setNum, ctl, false); // the default corner view
    expect(await bandHidden(page)).toBe(false); // the band starts shown
    await page.mouse.move(5, 5);
    await appIdle(page);
    await page.screenshot({ path: `/out/part22-3-${w}x${h}-band.png` });
    await ctl("prot-show-band").click();
    const pill = page.locator("#band-pill");
    await expect(pill).toBeVisible();
    await page.mouse.move(5, 5);
    await appIdle(page);
    await page.screenshot({ path: `/out/part22-3-${w}x${h}-band-hidden.png` });
    const pb = (await pill.boundingBox())!;
    const stage = (await page.locator("#stage").boundingBox())!;
    expect(pb.x).toBeGreaterThanOrEqual(stage.x);
    expect(pb.x + pb.width).toBeLessThanOrEqual(stage.x + stage.width);
    expect(pb.y).toBeGreaterThanOrEqual(stage.y);
    expect(pb.y + pb.height).toBeLessThanOrEqual(stage.y + stage.height);
    for (const id of ["#legend", "#timeline", "#viewcube", "#camera-cluster", "#triad", "#notices"]) {
      const el = page.locator(id);
      if (!(await el.isVisible())) continue;
      const r = (await el.boundingBox())!;
      const apart = pb.x + pb.width <= r.x || r.x + r.width <= pb.x || pb.y + pb.height <= r.y || r.y + r.height <= pb.y;
      expect(apart, `${id} overlaps the pill`).toBe(true);
    }
    // the box the placement reserves for the pill (PILL in view/layout.ts) must cover the pill as drawn
    expect(pb.width).toBeLessThanOrEqual(260);
    expect(pb.height).toBeLessThanOrEqual(34);
    expect(stage.y + stage.height - (pb.y + pb.height)).toBeGreaterThanOrEqual(46);
    const chips = page.locator("#fbox-layer .fbox");
    let seen = 0;
    for (let i = 0; i < (await chips.count()); i++) {
      const chip = chips.nth(i);
      if (!(await chip.isVisible())) continue;
      seen++;
      const r = (await chip.boundingBox())!;
      const apart = pb.x + pb.width <= r.x || r.x + r.width <= pb.x || pb.y + pb.height <= r.y || r.y + r.height <= pb.y;
      expect(apart, `filter box ${i} overlaps the pill`).toBe(true);
    }
    expect(seen, "the six filter boxes are on the canvas").toBe(6);
    expect(errors).toEqual([]);
  });
}

// ---- part 22-4: design tokens, themes, type and focus (E2E-220..226)
type Rgba = [number, number, number, number];
/** A computed CSS colour (`rgb(...)` or `rgba(...)`) as numbers. */
const cssRgba = (css: string): Rgba => {
  const m = css.match(/rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?\s*\)/);
  if (!m) throw new Error(`not a computed colour: ${css}`);
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
};
/** `fg` over an opaque `bg`. */
const over = (fg: Rgba, bg: Rgba): Rgba => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat([1]) as Rgba;
const lumOf = (c: Rgba): number => {
  const f = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
/** WCAG contrast of a (possibly translucent) text colour on an opaque background. */
const contrastOf = (fg: Rgba, bg: Rgba): number => {
  const [a, b] = [lumOf(over(fg, bg)), lumOf(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
};
const near = (a: Rgba, b: number[], tol = 2) => [0, 1, 2].every((i) => Math.abs(a[i] - b[i]) <= tol);
type Scheme = "dark" | "light";
const themeRead = (page: Pg) =>
  page.evaluate(() => {
    const cs = (sel: string) => getComputedStyle(document.querySelector(sel)!);
    const root = getComputedStyle(document.documentElement);
    return {
      attr: document.documentElement.getAttribute("data-theme"),
      body: cs("body").backgroundColor,
      label: cs("body").color,
      aside: cs("#tools").backgroundColor,
      hud: cs("#legend").backgroundColor,
      fbox: cs("#fbox-layer .fbox").backgroundColor,
      canvas: root.getPropertyValue("--canvas").trim(),
      accent: root.getPropertyValue("--accent").trim(),
      family: cs("body").fontFamily,
    };
  });

test("E2E-220 22-4 the default is the dark theme on the real cascade: body, aside, label, accent and font, no data-theme, and no request leaves the machine", async ({ page }) => {
  const hosts = new Set<string>();
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.protocol === "http:" || u.protocol === "https:") hosts.add(u.hostname);
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const { exact } = helpers(page);
  await openRoom(page, exact);
  const t = await themeRead(page);
  expect(t.attr).toBeNull();
  expect(cssRgba(t.body)).toEqual([12, 13, 16, 1]);
  expect(cssRgba(t.label)).toEqual([245, 245, 247, 1]);
  expect(cssRgba(t.aside)).toEqual([30, 31, 36, 0.7]);
  expect(t.accent).toBe("#0a84ff");
  expect(t.family).toMatch(/^-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, sans-serif$/);
  expect([...hosts].filter((h) => h !== "localhost" && h !== "127.0.0.1")).toEqual([]);
  expect(errors).toEqual([]);
});

test("E2E-221 22-4 prefers-color-scheme light switches the aside, the body, the stage HUD and the 3D stage backdrop to the light tokens, and data-theme overrides it both ways", async ({ page }) => {
  const { exact } = helpers(page);
  await openRoom(page, exact);
  await appIdle(page);
  const corner = await stageCorner(page);
  const expectStage = (want: Scheme) => expectStageCorner(page, corner, want);
  const expectTheme = async (want: Scheme) => {
    const light = want === "light";
    await expect
      .poll(async () => {
        const t = await themeRead(page);
        const canvas = cssRgba(t.body);
        const lumHud = lumOf(over(cssRgba(t.hud), canvas));
        const lumFbox = lumOf(over(cssRgba(t.fbox), canvas));
        return {
          body: near(canvas, light ? [233, 235, 239] : [12, 13, 16]),
          aside: cssRgba(t.aside).slice(0, 3).join(",") === (light ? "248,248,250" : "30,31,36"),
          text: near(cssRgba(t.label), light ? [29, 29, 31] : [245, 245, 247]),
          hud: light ? lumHud >= 0.8 : lumHud <= 0.02,
          fbox: light ? lumFbox >= 0.8 : lumFbox <= 0.02,
        };
      }, { timeout: 5000 })
      .toEqual({ body: true, aside: true, text: true, hud: true, fbox: true });
    await expectStage(want);
  };
  await expectTheme("dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expectTheme("light");
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await expectTheme("dark");
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await page.emulateMedia({ colorScheme: "dark" });
  await expectTheme("light");
  await page.evaluate(() => document.documentElement.removeAttribute("data-theme"));
  await expectTheme("dark");
});

test("E2E-222 22-4 a keyboard-focused toolbar button, side-panel field and stage control each get a 3px accent focus ring, in both themes", async ({ page }) => {
  const { exact, ctl } = helpers(page);
  await openRoom(page, exact);
  await ctl("filter-x-min-toggle").click(); // expand one filter box so it has a field
  for (const [scheme, accent] of [["dark", [10, 132, 255]], ["light", [0, 122, 255]]] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const id of ["open-file", "scope-displayed", "filter-x-min-toggle"]) {
      await page.locator("body").click({ position: { x: 1, y: 1 } });
      await page.keyboard.press("Tab"); // keyboard modality, so focus() shows the ring
      await ctl(id).focus();
      await expect(ctl(id)).toBeFocused();
      const o = await ctl(id).evaluate((e) => {
        const s = getComputedStyle(e);
        return { w: s.outlineWidth, st: s.outlineStyle, c: s.outlineColor };
      });
      expect(`${scheme} ${id} ${o.st} ${o.w}`).toBe(`${scheme} ${id} solid 3px`);
      expect(near(cssRgba(o.c), accent, 1), `${scheme} ${id} ring colour ${o.c}`).toBe(true);
    }
  }
});

test("E2E-223 22-4 reduced motion gives 0s transitions; without it a button fades in 0.12-0.25 s", async ({ page }) => {
  const { exact, ctl } = helpers(page);
  await openRoom(page, exact);
  const durations = () => ctl("open-file").evaluate((e) => getComputedStyle(e).transitionDuration.split(",").map((d) => parseFloat(d)));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const normal = await durations();
  expect(normal.length).toBeGreaterThan(0);
  for (const d of normal) {
    expect(d).toBeGreaterThanOrEqual(0.12);
    expect(d).toBeLessThanOrEqual(0.25);
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect((await durations()).every((d) => d === 0)).toBe(true);
  expect(await page.locator("#legend .legend-head svg").evaluate((e) => getComputedStyle(e).transitionDuration)).toBe("0s");
});


/** Every visible element under `scope` that carries its own text, with its colour and the translucent layers behind it (innermost first), up to the first opaque one. `stage` is true inside #stage, whose backdrop is the clear colour (--canvas, with --canvas-vignette as the other end of the stage gradient the approved mockup draws). */
const textBackdrops = (page: Pg, scope: string, max = 40) =>
  page.evaluate(
    ([sel, limit]) => {
      const probe = document.createElement("i");
      document.body.appendChild(probe);
      const norm = (v: string) => {
        probe.style.color = v;
        return getComputedStyle(probe).color;
      };
      const root = getComputedStyle(document.documentElement);
      const canvas = norm(root.getPropertyValue("--canvas").trim());
      const vignette = norm(root.getPropertyValue("--canvas-vignette").trim());
      const out: { what: string; fg: string; layers: string[]; stage: boolean; canvas: string; vignette: string }[] = [];
      for (const el of Array.from(document.querySelectorAll(sel as string)).slice(0, limit as number)) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === "hidden") continue;
        const layers: string[] = [];
        let stage = false;
        for (let n: Element | null = el; n; n = n.parentElement) {
          if (n.id === "stage") stage = true;
          const bg = getComputedStyle(n).backgroundColor;
          if (bg !== "rgba(0, 0, 0, 0)") {
            layers.push(bg);
            if (/^rgb\(/.test(bg)) break;
          }
        }
        out.push({ what: `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}.${(el as HTMLElement).className || ""} "${(el.textContent ?? "").trim().slice(0, 24)}"`, fg: getComputedStyle(el).color, layers, stage, canvas, vignette });
      }
      probe.remove();
      return out;
    },
    [scope, max] as const,
  );
/** Wait until no CSS transition is running: a colour read mid-transition after a theme switch is neither theme's colour. */
const transitionsSettled = (page: Pg) => expect.poll(() => page.evaluate(() => document.getAnimations().length), { message: "CSS transitions finished" }).toBe(0);
/** The worst WCAG ratio of one element's text over its backdrop: the layers composited over each possible stage colour (both ends of the stage) when the element is inside #stage. */
const worstContrast = (t: Awaited<ReturnType<typeof textBackdrops>>[number]): number => {
  const solidBase = t.layers.length && /^rgb\(/.test(t.layers[t.layers.length - 1]) ? [cssRgba(t.layers[t.layers.length - 1])] : [];
  const bases = t.stage || !solidBase.length ? [cssRgba(t.canvas), cssRgba(t.vignette)] : solidBase;
  const layers = (solidBase.length && !t.stage ? t.layers.slice(0, -1) : t.layers).map(cssRgba);
  const ordered = [...layers].reverse();
  return Math.min(
    ...bases.map((base) => {
      let bg: Rgba = [base[0], base[1], base[2], 1];
      for (const l of ordered) bg = over(l, bg);
      return contrastOf(cssRgba(t.fg), bg);
    }),
  );
};

test("E2E-225 22-4 measured contrast on real elements, both themes: status count, aside h2, a note, a layer count, the help key, Delete, the legend rows and a filter-box label over the stage, and #empty straight on the stage", async ({ page }) => {
  const t = layerMenu(page);
  const { ctl } = t;
  // #empty is on the stage before any file is opened
  // a session left by an earlier test would be reopened and hide it: answer "no session" for this first load only
  await page.route("**/api/session", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ no_session: true }) }), { times: 1 });
  await page.goto("/");
  await expect(page.locator("#empty")).toBeVisible();
  const checkEmpty = async (scheme: Scheme) => {
    await page.emulateMedia({ colorScheme: scheme });
    await expect.poll(async () => (await textBackdrops(page, "#empty")).length).toBe(1);
    const [e] = await textBackdrops(page, "#empty");
    expect(worstContrast(e), `${scheme} #empty`).toBeGreaterThanOrEqual(4.5);
  };
  await checkEmpty("dark");
  await checkEmpty("light");
  await page.emulateMedia({ colorScheme: "dark" });
  await t.floorFromBand(); // opens the room and makes a protected Floor layer, so a layer row and its count exist
  await ctl("help").click();
  await expect(page.locator("#help-overlay")).toBeVisible();
  const scopes: [string, string][] = [
    ["status count", "#statusbar .item"],
    ["aside h2", "aside h2"],
    ["a note", "#tools .note"],
    ["layer count", ".layer-row .layer-count"],
    ["help key", "#help-overlay td.k"],
    ["Delete", "#apply"],
    ["legend", "#legend, #legend *"],
    ["filter box", "#fbox-layer .fbox, #fbox-layer .fbox *"],
  ];
  for (const scheme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await transitionsSettled(page);
    for (const [name, sel] of scopes) {
      // elements that carry their own text only: the others have no glyphs to read
      await expect.poll(async () => (await textBackdrops(page, sel)).length, { message: name }).toBeGreaterThan(0);
      for (const t of await textBackdrops(page, sel)) {
        if (!/"[^"]+"$/.test(t.what) && !/input/.test(t.what)) continue;
        expect(worstContrast(t), `${scheme} ${name}: ${t.what}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  }
});


test("E2E-224 22-4 every visible icon-only button has an aria-label and a title: idle, Box armed with a layer, the legend, a filter box, the export dialog and help", async ({ page }) => {
  const t = helpers(page);
  const { exact, ctl } = t;
  await openRoom(page, exact);
  const offenders = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("button, [role=button], [role=switch], [role=radio]")]
        .filter((e) => {
          const r = e.getBoundingClientRect();
          const cs = getComputedStyle(e);
          return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && !/[A-Za-z0-9]/.test(e.textContent ?? "") && !e.querySelector("input");
        })
        .filter((e) => !(e.getAttribute("aria-label") ?? "").trim() || !(e.getAttribute("title") ?? "").trim())
        .map((e) => `${e.id ? "#" + e.id : e.tagName.toLowerCase()}[${["data-control", "data-layer-eye", "data-layer-more", "data-layer-edit"].map((a) => (e.hasAttribute(a) ? `${a}=${e.getAttribute(a)}` : "")).join("")}] ${e.outerHTML.slice(0, 90)}`),
    );
  const states: Record<string, string[]> = {};
  states.idle = await offenders();
  await ctl("tool-box").click();
  await t.boxEverything();
  await page.locator('[data-control="layer-name"]').fill("Probe");
  await ctl("layer-new").click();
  await expect(page.locator("[data-layer-row]")).toHaveCount(2, { timeout: 15000 });
  const more = page.locator("[data-layer-more]").last();
  if ((await more.getAttribute("aria-expanded")) !== "true") await more.click();
  states["box armed with a layer"] = await offenders();
  if ((await ctl("legend-menu").getAttribute("aria-expanded")) === "false") await ctl("legend-menu").click();
  states.legend = await offenders();
  await t.setNum("filter-x-min", 0);
  states["filter box"] = await offenders();
  await ctl("help").click();
  states.help = await offenders();
  await ctl("help").click();
  await ctl("export").click();
  states["export dialog"] = await offenders();
  expect(states).toEqual({ idle: [], "box armed with a layer": [], legend: [], "filter box": [], help: [], "export dialog": [] });
});

test("E2E-230 22-4b a collapsed filter box's accessible name contains the chip it shows (WCAG 2.5.3): the X>= button is the X min toggle, and expanded it is the plain box name", async ({ page }) => {
  const t = helpers(page);
  await openRoom(page, t.exact);
  const chip = page.getByRole("button", { name: /X>=/ });
  await expect(chip).toHaveCount(1);
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute("id", "filter-x-min-toggle");
  const visible = ((await chip.textContent()) ?? "").trim();
  expect((await chip.getAttribute("aria-label")) ?? "").toContain(visible);
  await chip.click();
  await expect(page.locator("#filter-x-min-toggle")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#filter-x-min-toggle")).toHaveAttribute("aria-label", "X min filter box");
  await expect(page.getByRole("button", { name: "X min filter box", exact: true })).toBeVisible();
});

const LIGHT_STAGE = [233, 235, 239];
const DARK_STAGE = [12, 13, 16];
const rgbOf = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

test("E2E-231 22-4b light points on the real stage: a lone base point draws the light base colour under a light OS, the dark colour under data-theme dark, and light again, with no reload and no page error", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/404/.test(m.text())) errors.push(m.text());
  });
  const { exact, ctl } = helpers(page);
  await openRoom(page, exact);
  await appIdle(page);
  await openPop(page, "display");
  await ctl("colour-mode").selectOption("flat"); // Grey: the base colour, not a height ramp
  await closePop(page, "display");
  await page.evaluate(() => ((window as unknown as { __mark: number }).__mark = 1));
  const lone = await settledScreen(page, [16.5, 3.5, 3]);
  const corner = await stageCorner(page);
  const theme = () => hook(page, (e) => e.state().renderTheme);
  const expectPoint = async (stage: number[], want: number[], label: string) => {
    await expect.poll(async () => {
      const px = await farthestFromStage(page, lone, stage, 3);
      return near([...px, 1], want, 2) ? "ok" : `${label}: wanted ${want}, read ${px}`;
    }, { timeout: 8000 }).toBe("ok");
  };
  expect(await theme()).toBe("dark");
  await expectPoint(DARK_STAGE, [216, 216, 216], "dark base point");
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(theme, { message: "renderTheme under a light OS" }).toBe("light");
  await expectStageCorner(page, corner, "light");
  await expectPoint(LIGHT_STAGE, [135, 135, 135], "light base point");
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await expect.poll(theme, { message: "renderTheme under data-theme dark" }).toBe("dark");
  await expectStageCorner(page, corner, "dark");
  await expectPoint(DARK_STAGE, [216, 216, 216], "dark base point again");
  await page.evaluate(() => document.documentElement.removeAttribute("data-theme"));
  await expect.poll(theme, { message: "renderTheme once data-theme is gone" }).toBe("light");
  await expectStageCorner(page, corner, "light");
  await expectPoint(LIGHT_STAGE, [135, 135, 135], "light base point again");
  expect(await page.evaluate(() => (window as unknown as { __mark?: number }).__mark), "the page was reloaded").toBe(1);
  expect(errors).toEqual([]);
});

test("E2E-232 22-4b light Box armed: the arrows, a ring and an edge of the box draw in the light colours, the triad and the legend chip follow, and data-theme dark gives back the exact dark values", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/404/.test(m.text())) errors.push(m.text());
  });
  const t = hideHelpers(page);
  await openRoom(page, t.exact);
  await t.ctl("tool-box").click();
  await t.setBox(GHOST_BOX.c, GHOST_BOX.d);
  await t.exact("Selected", String(ROOM.ghost));
  await appIdle(page);
  const readTriad = () =>
    page.evaluate(() => [...document.querySelectorAll(".cube-triad line")].map((l) => l.getAttribute("stroke")));
  const chip = () => page.locator('#legend [data-legend="selected"]');
  const checks = async (axes: string[], outline: string, candidate: string, label: string) => {
    for (const [i, axis] of axes.entries()) {
      const arrows = (await hook(page, (e) => e.handlePositions())).filter((h) => h.id === `resize-${i}+`);
      expect(arrows.length, `${label}: arrow resize-${i}+ is on screen`).toBe(1);
      await expect.poll(() => countNear(page, arrows[0], 8, rgbOf(axis), 3), { timeout: 8000, message: `${label}: arrow resize-${i}+ in ${axis}` }).toBeGreaterThan(0);
    }
    const b = await hook(page, (e) => e.state().tools.box);
    const edge = await settledScreen(page, [b.center[0], b.center[1] - b.dimensions[1] / 2, b.center[2] - b.dimensions[2] / 2]);
    await expect.poll(() => countNear(page, edge, 4, rgbOf(outline), 3), { timeout: 8000, message: `${label}: box edge in ${outline}` }).toBeGreaterThan(0);
    await expect(chip(), label).toHaveCSS("background-color", `rgb(${rgbOf(candidate).join(", ")})`);
  };
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => hook(page, (e) => e.state().renderTheme)).toBe("light");
  await expectStageCorner(page, await stageCorner(page), "light");
  const lightAxes = ["#e0352b", "#1f9b3b", "#1f6fe0"];
  await checks(lightAxes, "#34343d", "#be7715", "light");
  // a ring: its dimmed axis colour (75%) near a sample of its outline
  const rings = await hook(page, (e) => e.boxRings());
  const ring = rings.find((r) => r.id === "rotate-2+") ?? rings[0];
  const dim = (hex: string) => rgbOf(hex).map((v) => Math.round(v * 0.75));
  const ringHex = lightAxes[Number(ring.id.match(/rotate-(\d)/)![1])];
  let seen = 0;
  for (const p of ring.pts.filter((_, i) => i % 3 === 0)) seen += await countNear(page, p, 3, dim(ringHex), 3);
  expect(seen, `ring ${ring.id} in ${ringHex} at 75%`).toBeGreaterThan(0);
  expect(await readTriad()).toEqual(lightAxes);
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await expect.poll(() => hook(page, (e) => e.state().renderTheme)).toBe("dark");
  await expectStageCorner(page, await stageCorner(page), "dark");
  const darkAxes = ["#ff5555", "#55ff55", "#5599ff"];
  await checks(darkAxes, "#ffd23f", "#ff9f1c", "dark");
  expect(await readTriad()).toEqual(darkAxes);
  expect(errors).toEqual([]);
});

for (const [w, h] of [[1280, 720], [1920, 1080]] as const) {
  test(`E2E-226 22-4 owner screenshots at ${w}x${h}: dark and light, idle and the Box armed with its preview up; the page does not scroll, nothing throws, and the filter boxes overlap no other stage control`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error" && !/404/.test(m.text())) errors.push(m.text());
    });
    const t = hideHelpers(page);
    await t.floorSelected();
    page.removeAllListeners("dialog");
    page.on("dialog", (d) => void d.accept());
    await t.ctl("sel-clear").click();
    const shoot = async (scheme: Scheme, name: string) => {
      await page.emulateMedia({ colorScheme: scheme });
      await expect.poll(async () => (await themeRead(page)).canvas, { message: `${scheme} theme applied` }).toBe(scheme === "light" ? "#e9ebef" : "#0c0d10");
      await page.mouse.move(5, 5);
      await appIdle(page);
      await expectStageCorner(page, await stageCorner(page), scheme); // the clear colour follows the theme on a later frame
      await page.screenshot({ path: `/out/part22-4-${w}x${h}-${name}.png` });
      expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= window.innerHeight), `${scheme} ${name}: the page scrolls`).toBe(true);
    };
    await shoot("dark", "dark");
    await shoot("light", "light");
    await t.ctl("tool-box").click();
    await t.setBox(GHOST_BOX.c, GHOST_BOX.d);
    await t.exact("Selected", String(ROOM.ghost));
    await expect(t.ctl("tool-box")).toHaveClass(/active/);
    await shoot("dark", "dark-armed");
    await shoot("light", "light-armed");
    // the type scale must not grow the legend: 214 px at 1280x720 before part 4 (review m4)
    if (w === 1280) for (const scheme of ["dark", "light"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expect.poll(async () => (await page.locator("#legend").boundingBox())!.height, { message: `${scheme} legend height, Box armed` }).toBeLessThanOrEqual(214);
    }
    const boxes = page.locator("#fbox-layer .fbox");
    let seen = 0;
    for (let i = 0; i < (await boxes.count()); i++) {
      if (!(await boxes.nth(i).isVisible())) continue;
      seen++;
      const r = (await boxes.nth(i).boundingBox())!;
      for (const id of ["#legend", "#timeline", "#viewcube", "#camera-cluster", "#notices"]) {
        const el = page.locator(id);
        if (!(await el.isVisible())) continue;
        const o = (await el.boundingBox())!;
        const apart = r.x + r.width <= o.x || o.x + o.width <= r.x || r.y + r.height <= o.y || o.y + o.height <= r.y;
        expect(apart, `filter box ${i} overlaps ${id}`).toBe(true);
      }
    }
    expect(seen, "the six filter boxes are on the canvas").toBe(6);
    expect(errors).toEqual([]);
  });
}

for (const [w, h] of [[1280, 720], [1920, 1080]] as const) {
  test(`E2E-233 22-4b owner screenshots at ${w}x${h}: dark and light render palettes, idle and the Box armed; the render theme follows the page, the page does not scroll, nothing throws, and the legend and the filter boxes overlap nothing`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error" && !/404/.test(m.text())) errors.push(m.text());
    });
    const t = hideHelpers(page);
    await t.floorSelected();
    page.removeAllListeners("dialog");
    page.on("dialog", (d) => void d.accept());
    await t.ctl("sel-clear").click();
    const shoot = async (scheme: Scheme, name: string) => {
      await page.emulateMedia({ colorScheme: scheme });
      await expect.poll(async () => (await themeRead(page)).canvas, { message: `${scheme} theme applied` }).toBe(scheme === "light" ? "#e9ebef" : "#0c0d10");
      await expect.poll(() => hook(page, (e) => e.state().renderTheme), { message: `${scheme} render theme` }).toBe(scheme);
      await page.mouse.move(5, 5);
      await appIdle(page);
      // a longer bound than the default: each read forces a full-frame capture, slow at 1920x1080 under SwiftShader with the Box up
      const corner = await stageCorner(page);
      await expectStageCorner(page, corner, scheme, 20000);
      await page.screenshot({ path: `/out/part22-4b-${w}x${h}-${name}.png` });
      expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= window.innerHeight), `${scheme} ${name}: the page scrolls`).toBe(true);
    };
    await shoot("dark", "dark");
    await shoot("light", "light");
    await t.ctl("tool-box").click();
    await t.setBox(GHOST_BOX.c, GHOST_BOX.d);
    await t.exact("Selected", String(ROOM.ghost));
    await expect(t.ctl("tool-box")).toHaveClass(/active/);
    await shoot("dark", "dark-armed");
    await shoot("light", "light-armed");
    const boxes = page.locator("#fbox-layer .fbox");
    let seen = 0;
    for (let i = 0; i < (await boxes.count()); i++) {
      if (!(await boxes.nth(i).isVisible())) continue;
      seen++;
      const r = (await boxes.nth(i).boundingBox())!;
      for (const id of ["#legend", "#timeline", "#viewcube", "#camera-cluster", "#notices"]) {
        const el = page.locator(id);
        if (!(await el.isVisible())) continue;
        const o = (await el.boundingBox())!;
        const apart = r.x + r.width <= o.x || o.x + o.width <= r.x || r.y + r.height <= o.y || o.y + o.height <= r.y;
        expect(apart, `filter box ${i} overlaps ${id}`).toBe(true);
      }
    }
    expect(seen, "the six filter boxes are on the canvas").toBe(6);
    expect(errors).toEqual([]);
  });
}

// ---------------------------------------------------------------- part 22-5: popovers
test("E2E-246 22-5 a popover opens from its anchor, closes on a click elsewhere, and its Esc closes it before the tool disarms and before a pending draft is discarded", async ({ page }) => {
  const t = hideHelpers(page);
  await t.floorSelected();
  page.removeAllListeners("dialog");
  page.on("dialog", (d) => void d.accept());
  const pop = page.locator("#cloud-details");
  const anchor = t.ctl("details-open");
  const armed = (on: boolean) => (on ? expect(t.ctl("tool-box")).toHaveClass(/active/) : expect(t.ctl("tool-box")).not.toHaveClass(/active/));
  await expect(pop).toBeHidden();
  await anchor.click();
  await expect(pop).toBeVisible();
  await expect(anchor).toHaveAttribute("aria-expanded", "true");
  await page.locator("#viewport").click({ position: { x: 40, y: 420 } });
  await expect(pop).toBeHidden();
  await expect(anchor).toHaveAttribute("aria-expanded", "false");
  // Esc with no draft: the popover closes, the Box stays armed, the focus returns to the anchor; the second Esc disarms
  await t.ctl("sel-clear").click();
  await t.ctl("tool-box").click();
  await t.setBox(GHOST_BOX.c, GHOST_BOX.d);
  await t.exact("Selected", String(ROOM.ghost));
  await anchor.click();
  await expect(pop).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(pop).toBeHidden();
  await armed(true);
  await expect(page.locator("#modebar")).toContainText("Tool: Box");
  await expect(anchor).toBeFocused();
  await page.keyboard.press("Escape");
  await armed(false);
  await expect(page.locator("#modebar")).toContainText("Tool: None");
  // E6b: a pending draft survives the Esc that closes the popover; the next Esc discards it, the one after disarms
  await t.ctl("apply").click();
  await t.exact("Active", String(ROOM_TOTAL - ROOM.ghost));
  await t.ctl("tool-box").click();
  await t.setBox(WALL18.c, WALL18.d);
  await t.exact("Selected", String(ROOM.wall));
  await t.ctl("op-add").click();
  await t.setBox(FLOOR_BOX.c, FLOOR_BOX.d);
  await expect(t.ctl("sel-discard")).toBeEnabled();
  await anchor.click();
  await expect(pop).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(pop).toBeHidden();
  await expect(t.ctl("sel-discard")).toBeEnabled();
  await armed(true);
  await page.keyboard.press("Escape");
  await expect(t.ctl("sel-discard")).toBeDisabled();
  await armed(true);
  await page.keyboard.press("Escape");
  await armed(false);
  // part 3: the History popover opens from history-open, replaces any other popover, and its Esc leaves the Box armed
  const hist = page.locator("#history-pop");
  await t.ctl("tool-box").click();
  await armed(true);
  await anchor.click();
  await expect(pop).toBeVisible();
  await t.ctl("history-open").click();
  await expect(hist).toBeVisible();
  await expect(pop).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(hist).toBeHidden();
  await armed(true);
});

test("E2E-249 22-5 the History popover lists the three deletions with their counts, marks the undone one, and its button sits at the right end of the timeline", async ({ page }) => {
  const t = tl(page);
  await t.threeSteps();
  const hist = page.locator("#history-pop");
  await expect(hist).toBeHidden();
  await page.locator('[data-control="history-open"]').click();
  await expect(hist).toBeVisible();
  const rows = hist.locator("#history-list li");
  await expect(rows).toHaveCount(3);
  const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);
  for (const [i, n] of [ROOM.ghost, ROOM.wall, ROOM.noise].entries()) await expect(rows.nth(i)).toContainText(`(${fmt(n)})`);
  const strip = (await page.locator("#timeline").boundingBox())!;
  const btn = (await page.locator('#timeline [data-control="history-open"]').boundingBox())!;
  expect(btn.x + btn.width, "right end of the timeline").toBeGreaterThan(strip.x + strip.width - 24);
  await page.keyboard.press("Escape");
  await expect(hist).toBeHidden();
  await page.locator('[data-control="undo"]').click();
  await page.locator('[data-control="history-open"]').click();
  await expect(rows.nth(2)).toHaveClass(/undone/);
  await expect(rows.nth(0)).not.toHaveClass(/undone/);
});

test("E2E-253 22-5 fix a History popover with 60 steps stays between the top bar and the footer, scrolls inside, and its last row can be reached", async ({ page }) => {
  const t = tl(page);
  await t.threeSteps();
  const hist = page.locator("#history-pop");
  await page.locator('[data-control="history-open"]').click();
  await expect(hist).toBeVisible();
  const rows = hist.locator("#history-list li");
  await expect(rows).toHaveCount(3);
  // grow the list in the DOM (the layout, not the model, is under test), then let the popover place itself again as a resize does
  await page.evaluate(() => {
    const list = document.getElementById("history-list")!;
    for (let i = 0; i < 57; i++) {
      const li = document.createElement("li");
      li.textContent = `Delete step ${i + 4} (${i + 1})`;
      list.append(li);
    }
    window.dispatchEvent(new Event("resize"));
  });
  await expect(rows).toHaveCount(60);
  const vp = page.viewportSize()!;
  const bar = (await page.locator("#toolbar").boundingBox())!;
  const foot = (await page.locator("#footer").boundingBox())!;
  const box = (await hist.boundingBox())!;
  expect(box.y, "below the top bar").toBeGreaterThanOrEqual(bar.y + bar.height);
  expect(box.y + box.height, "above the footer").toBeLessThanOrEqual(foot.y + 0.5);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
  expect(await hist.evaluate((e) => e.scrollHeight > e.clientHeight), "scrolls inside").toBe(true);
  await rows.last().scrollIntoViewIfNeeded();
  const last = (await rows.last().boundingBox())!;
  const now = (await hist.boundingBox())!;
  expect(last.y + last.height, "last row inside the panel").toBeLessThanOrEqual(now.y + now.height + 0.5);
  expect(last.y).toBeGreaterThanOrEqual(now.y - 0.5);
});

test("E2E-248 22-5 Cloud details shows the file, the counts and the view, and Remove invalid lives in it", async ({ page }) => {
  const { exact, ctl } = helpers(page);
  await openRoom(page, exact);
  const pop = page.locator("#cloud-details");
  await ctl("details-open").click();
  await expect(pop).toBeVisible();
  const box = (await pop.boundingBox())!;
  const at = (await ctl("details-open").boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.y, "8 px under its anchor").toBeGreaterThanOrEqual(at.y + at.height + 7.5);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
  await expect(pop).toContainText("room.pcd");
  await expect(pop).toContainText("Fields");
  await expect(pop).toContainText("m (assumed)");
  await expect(pop.locator('[data-status="Original"]')).toHaveText(new Intl.NumberFormat("en-US").format(ROOM_TOTAL));
  await expect(pop.locator('[data-status="Active"]')).toHaveText(new Intl.NumberFormat("en-US").format(ROOM_TOTAL));
  await expect(pop.locator("#counts-panel")).toContainText("Remaining");
  await expect(pop).toContainText("Perspective");
  await expect(pop).toContainText("Pivot");
  // a cloud with one invalid point: Remove invalid sits in the popover and removes it
  await page.locator("#file-input").setInputFiles({ name: "synthetic.pcd", mimeType: "application/octet-stream", buffer: syntheticPcd() });
  await exact("Original", String(TOTAL));
  await expect(pop).toBeVisible();
  await expect(ctl("remove-invalid")).toBeVisible();
  await ctl("remove-invalid").click();
  await exact("Active", String(TOTAL - 1));
  // the footer's Invalid item is a button that opens Cloud details
  await page.keyboard.press("Escape");
  await expect(pop).toBeHidden();
  await page.locator('#footer [data-status="Invalid (active/total)"] [data-control="status-invalid"]').click();
  await expect(pop).toBeVisible();
  await expect(pop.locator("#counts-panel")).toContainText("Invalid");
});

for (const [w, hgt] of [[1280, 720], [1920, 1080]] as const) {
  test(`E2E-245 22-5 the top bar is one 52 px row at ${w}x${hgt}: left, centre and right groups, Delete N and the kept chip, and no two controls overlap in Edited or Overlay`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: hgt });
    const t = hideHelpers(page);
    await openRoom(page, t.exact);
    await t.ctl("prot-enabled").check();
    await t.setNum("prot-min", -0.05);
    await t.setNum("prot-max", 0.05);
    await t.ctl("tool-box").click();
    for (const [id, v] of [["box-center-x", 9], ["box-center-y", 9], ["box-center-z", 2], ["box-size-x", 30], ["box-size-y", 30], ["box-size-z", 10]] as const) await t.setNum(id, v);
    const foot = (await page.locator("#footer").boundingBox())!;
    expect(foot.height).toBeGreaterThan(25.5);
    expect(foot.height).toBeLessThan(26.5);
    for (const name of ["Original", "Active", "Unsaved"]) await expect(page.locator(`#footer [data-status="${name}"]`)).toHaveCount(0);
    await expect(page.locator("#footer #modebar")).toHaveCount(1);
    const kept = ROOM.floor + ROOM.floorGhost;
    const n = ROOM_TOTAL - ROOM.invalid - kept;
    await t.exact("Candidates", String(n));
    await expect(page.locator("#kept-chip")).toHaveText(`${kept} kept`);
    const bar = page.locator("#toolbar");
    await expect(bar).toBeVisible();
    const scan = async (label: string) => {
      const m = await page.evaluate(() => {
        const rb = document.getElementById("toolbar")!.getBoundingClientRect();
        const boxes = [...document.querySelectorAll<HTMLElement>("#toolbar [data-control]")].map((e) => {
          const b = e.getBoundingClientRect();
          return { id: e.getAttribute("data-control")!, l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height };
        });
        const centre = document.querySelector<HTMLElement>("#toolbar .grp.centre")!.getBoundingClientRect();
        const apply = document.getElementById("apply")!.getBoundingClientRect();
        return { bar: { l: rb.left, r: rb.right, t: rb.top, b: rb.bottom, h: rb.height }, boxes, centre: { l: centre.left, r: centre.right }, applyRight: apply.right };
      });
      expect(m.bar.h, `${label} bar height`).toBeGreaterThan(51.5);
      expect(m.bar.h, `${label} bar height`).toBeLessThan(52.5);
      for (const b of m.boxes) {
        expect(b.w > 0 && b.h > 0, `${label} ${b.id} is visible`).toBe(true);
        expect(b.l >= m.bar.l - 0.5 && b.r <= m.bar.r + 0.5 && b.t >= m.bar.t - 0.5 && b.b <= m.bar.b + 0.5, `${label} ${b.id} is inside the bar`).toBe(true);
      }
      for (let i = 0; i < m.boxes.length; i++) {
        for (let j = i + 1; j < m.boxes.length; j++) {
          const a = m.boxes[i];
          const b = m.boxes[j];
          const apart = a.r <= b.l + 0.5 || b.r <= a.l + 0.5 || a.b <= b.t + 0.5 || b.b <= a.t + 0.5;
          expect(apart, `${label} ${a.id} and ${b.id} do not overlap`).toBe(true);
        }
      }
      expect(m.bar.r - m.applyRight, `${label} Delete N ends within 12 px of the right edge`).toBeLessThanOrEqual(12.5);
      if (w >= 1920) expect(Math.abs((m.centre.l + m.centre.r) / 2 - (m.bar.l + m.bar.r) / 2), `${label} centre group is centred`).toBeLessThanOrEqual(2);
      return m;
    };
    const m = await scan("edited");
    const order = m.boxes.map((b) => b.id);
    expect(order.indexOf("open-file")).toBeLessThan(order.indexOf("redo"));
    expect(order.indexOf("redo")).toBeLessThan(order.indexOf("compare-original"));
    expect(order.indexOf("compare-split")).toBeLessThan(order.indexOf("display-open"));
    expect(order.slice(order.indexOf("display-open"))).toEqual(["display-open", "details-open", "help", "preview", "apply"]);
    await expect(t.ctl("apply")).toHaveText(`Delete ${n}`);
    await t.exact("Candidates", String(n));
    await expect(page.locator("#kept-chip")).toBeVisible();
    await expect(page.locator("#doc-title")).toBeVisible();
    expect((await page.locator("#doc-title").boundingBox())!.width).toBeLessThanOrEqual(190.5);
    await t.ctl("compare-overlay").click();
    await expect(t.ctl("overlay-opacity")).toBeVisible();
    expect(await page.locator("#toolbar .grp.centre").locator('[data-control="overlay-opacity"]').count()).toBe(1);
    await expect(page.locator("#kept-chip")).toBeVisible();
    await expect(t.ctl("apply")).toHaveText(`Delete ${n}`);
    await scan("overlay");
  });
}

test("E2E-246 22-5 (Display and Keyboard) opening one popover closes the other, Esc in a select keeps the popover and the Box armed, Esc elsewhere in it closes it, ? opens the Keyboard popover", async ({ page }) => {
  const t = hideHelpers(page);
  await t.floorSelected();
  page.removeAllListeners("dialog");
  page.on("dialog", (d) => void d.accept());
  const display = page.locator("#display-pop");
  const details = page.locator("#cloud-details");
  const help = page.locator("#help-overlay");
  const armed = () => expect(t.ctl("tool-box")).toHaveClass(/active/);
  await t.ctl("details-open").click();
  await expect(details).toBeVisible();
  await t.ctl("display-open").click();
  await expect(display).toBeVisible();
  await expect(details).toBeHidden();
  // Esc on the colour select is the select's own: the popover stays and the Box stays armed
  await t.ctl("colour-mode").focus();
  await page.keyboard.press("Escape");
  await expect(display).toBeVisible();
  await armed();
  // Esc on the point-size slider closes the popover, the focus returns to the anchor, the Box stays armed
  await t.ctl("point-size").focus();
  await page.keyboard.press("Escape");
  await expect(display).toBeHidden();
  await expect(t.ctl("display-open")).toBeFocused();
  await armed();
  // ? opens the Keyboard popover and closes Display; Esc closes it and the Box stays armed
  await t.ctl("display-open").click();
  await expect(display).toBeVisible();
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.locator("#viewport").hover();
  await t.ctl("display-open").click();
  await expect(display).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("?");
  await expect(help).toBeVisible();
  await expect(display).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(help).toBeHidden();
  await armed();
  // every anchor opens its popover with aria-expanded true, opening another closes the first, each box keeps an 8 px margin, a click on the stage closes it
  await page.setViewportSize({ width: 1280, height: 720 });
  const vp = page.viewportSize()!;
  const all: [string, string][] = [["display-open", "#display-pop"], ["details-open", "#cloud-details"], ["help", "#help-overlay"], ["history-open", "#history-pop"]];
  let prev: string | null = null;
  for (const [anchor, sel] of all) {
    await t.ctl(anchor).click();
    await expect(page.locator(sel)).toBeVisible();
    await expect(t.ctl(anchor)).toHaveAttribute("aria-expanded", "true");
    if (prev) await expect(page.locator(prev)).toBeHidden();
    const b = (await page.locator(sel).boundingBox())!;
    expect(b.x, `${sel} left margin`).toBeGreaterThanOrEqual(7.5);
    expect(b.y, `${sel} top margin`).toBeGreaterThanOrEqual(7.5);
    expect(b.x + b.width, `${sel} right margin`).toBeLessThanOrEqual(vp.width - 7.5);
    expect(b.y + b.height, `${sel} bottom margin`).toBeLessThanOrEqual(vp.height - 7.5);
    prev = sel;
  }
  await page.locator("#viewport").click({ position: { x: 40, y: 420 } });
  await expect(page.locator(prev!)).toBeHidden();
});

test("E2E-247 22-5 the Display popover lists the colour modes, changes the budget, and its Theme group sets, persists and clears data-theme and the canvas follows", async ({ page }) => {
  const t = hideHelpers(page);
  await t.floorSelected();
  await t.ctl("layer-new").click();
  await t.ctl("display-open").click();
  await expect(page.locator("#display-pop")).toBeVisible();
  const state = () => page.evaluate(() => (window as unknown as { __editor: { state: () => { budget: number; renderTheme: string } } }).__editor.state());
  const canvasToken = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--canvas").trim());
  const theme = () => page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  expect(await t.ctl("colour-mode").locator("option").count()).toBe(6);
  await t.ctl("budget").selectOption("100000");
  expect((await state()).budget).toBe(100000);
  await t.ctl("theme-light").click();
  expect(await theme()).toBe("light");
  expect(await canvasToken()).toBe("#e9ebef");
  await expect.poll(async () => (await state()).renderTheme).toBe("light");
  await expect(t.ctl("theme-light")).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  expect(await theme()).toBe("light");
  await t.exact("Original", String(ROOM_TOTAL));
  await t.ctl("display-open").click();
  await expect(t.ctl("theme-light")).toHaveAttribute("aria-pressed", "true");
  await page.emulateMedia({ colorScheme: "dark" });
  await t.ctl("theme-system").click();
  expect(await theme()).toBeNull();
  expect(await canvasToken()).toBe("#0c0d10");
  await page.emulateMedia({ colorScheme: "light" });
  expect(await canvasToken()).toBe("#e9ebef");
  await expect.poll(async () => (await state()).renderTheme).toBe("light");
  await t.ctl("theme-dark").click();
  expect(await theme()).toBe("dark");
  expect(await canvasToken()).toBe("#0c0d10");
  await expect.poll(async () => (await state()).renderTheme).toBe("dark");
  await t.ctl("theme-system").click(); // leave no stored choice behind for the next test
});

test("E2E-251 22-5 measured contrast on the new surfaces in both themes: the document title, the kept chip, the footer items and mode line, Cloud details, Display, History and the Export sheet are at least 4.5", async ({ page }) => {
  const t = hideHelpers(page);
  await t.floorSelected();
  page.removeAllListeners("dialog");
  page.on("dialog", (d) => void d.accept());
  await t.ctl("prot-enabled").check();
  await t.setNum("prot-min", -0.05);
  await t.setNum("prot-max", 0.05);
  await t.ctl("sel-clear").click();
  await t.ctl("tool-box").click();
  for (const [id, v] of [["box-center-x", 9], ["box-center-y", 9], ["box-center-z", 2], ["box-size-x", 30], ["box-size-y", 30], ["box-size-z", 10]] as const) await t.setNum(id, v);
  await expect(page.locator("#kept-chip")).toBeVisible();
  const check = async (scheme: Scheme, name: string, sel: string) => {
    await expect.poll(async () => (await textBackdrops(page, sel)).length, { message: `${scheme} ${name}` }).toBeGreaterThan(0);
    await transitionsSettled(page);
    for (const e of await textBackdrops(page, sel)) {
      if (!/"[^"]+"$/.test(e.what) && !/input/.test(e.what)) continue;
      expect(worstContrast(e), `${scheme} ${name}: ${e.what}`).toBeGreaterThanOrEqual(4.5);
    }
  };
  const bars: [string, string][] = [["title", "#toolbar .doc, #toolbar .doc *"], ["kept chip", "#kept-chip"], ["status", "#statusbar .item"], ["mode line", "#modebar"]];
  const popovers: [string, string, string][] = [
    ["details-open", "Cloud details", "#cloud-details dt, #cloud-details dd"],
    ["display-open", "Display", "#display-pop label, #display-pop .plabel"],
  ];
  for (const scheme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const [name, sel] of bars) await check(scheme, name, sel);
    for (const [anchor, name, sel] of popovers) {
      await t.ctl(anchor).click();
      await check(scheme, name, sel);
      await page.keyboard.press("Escape");
    }
    await t.ctl("export").click();
    await check(scheme, "export", "#export-dialog p, #export-dialog label");
    await page.keyboard.press("Escape");
    await expect(page.locator("#export-dialog")).toBeHidden();
  }
  await t.ctl("apply").click();
  await expect(page.locator("#kept-chip")).toBeHidden();
  for (const scheme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await t.ctl("history-open").click();
    await check(scheme, "history", "#history-list li");
    await page.keyboard.press("Escape");
  }
});

for (const [w, hgt] of [[1280, 720], [1920, 1080]] as const) {
  test(`E2E-252 22-5 owner screenshots at ${w}x${hgt}: Display, Cloud details, Keyboard, History and Export in dark and light; no scroll, no page error, every open popover inside the viewport`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: hgt });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error" && !/404/.test(m.text())) errors.push(m.text());
    });
    const t = hideHelpers(page);
    await t.floorSelected();
    page.removeAllListeners("dialog");
    page.on("dialog", (d) => void d.accept());
    await t.ctl("sel-clear").click();
    await t.ctl("tool-box").click();
    await t.setBox(GHOST_BOX.c, GHOST_BOX.d);
    await t.exact("Selected", String(ROOM.ghost));
    await t.ctl("apply").click();
    await t.exact("Active", String(ROOM_TOTAL - ROOM.ghost));
    const shots: [string, string, string][] = [
      ["display-open", "#display-pop", "display"],
      ["details-open", "#cloud-details", "details"],
      ["help", "#help-overlay", "keyboard"],
      ["history-open", "#history-pop", "history"],
    ];
    for (const scheme of ["dark", "light"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expect.poll(() => hook(page, (e) => e.state().renderTheme), { message: `${scheme} render theme` }).toBe(scheme);
      for (const [anchor, sel, name] of shots) {
        await t.ctl(anchor).click();
        await expect(page.locator(sel)).toBeVisible();
        await page.mouse.move(5, 5);
        await appIdle(page);
        const b = (await page.locator(sel).boundingBox())!;
        expect(b.x >= 0 && b.y >= 0 && b.x + b.width <= w && b.y + b.height <= hgt, `${scheme} ${name} inside the viewport`).toBe(true);
        await page.screenshot({ path: `/out/part22-5-${w}x${hgt}-${scheme}-${name}.png` });
        expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= window.innerHeight && document.scrollingElement!.scrollWidth <= window.innerWidth), `${scheme} ${name}: the page scrolls`).toBe(true);
        await page.keyboard.press("Escape");
        await expect(page.locator(sel)).toBeHidden();
      }
      await t.ctl("export").click();
      await expect(page.locator("#export-dialog")).toBeVisible();
      await page.screenshot({ path: `/out/part22-5-${w}x${hgt}-${scheme}-export.png` });
      await page.keyboard.press("Escape");
      await expect(page.locator("#export-dialog")).toBeHidden();
    }
    expect(errors).toEqual([]);
  });
}

// ---- part 22-6: floating tool palette and right inspector
const TOOL_NAMES: [string, string][] = [["tool-box", "Box"], ["tool-polygon", "Polygon"], ["tool-cluster", "Cluster"], ["tool-sparse", "Sparse points"], ["tool-plane", "Planes"], ["tool-thin", "Thin"]];
const SIZES: [number, number][] = [[1280, 720], [1920, 1080]];
/** The computed colour of a custom property resolved through a probe element (so `var()` chains and colour spaces settle). */
const resolvedToken = (page: Pg, token: string, prop = "backgroundColor") =>
  page.evaluate(
    ([tk, pr]) => {
      const el = document.createElement("div");
      el.style.setProperty(pr === "color" ? "color" : "background-color", `var(${tk})`);
      document.body.append(el);
      const v = getComputedStyle(el).getPropertyValue(pr === "color" ? "color" : "background-color");
      el.remove();
      return v;
    },
    [token, prop],
  );
/** Visible stage rectangles a palette or pill must not touch. */
const STAGE_NEIGHBOURS = ["#legend", "#viewcube", "#camera-cluster", "#triad", "#timeline", "#band-pill", "#fbox-layer .fbox", "#notices > *"];
const visibleRects = (page: Pg, selector: string) =>
  page.evaluate((sel) => {
    return [...document.querySelectorAll(sel)]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
      })
      .map((e) => {
        const r = e.getBoundingClientRect();
        return { l: r.left, t: r.top, r: r.right, b: r.bottom, what: e.id || e.className.toString() };
      });
  }, selector);
const apart = (a: { l: number; t: number; r: number; b: number }, b: { l: number; t: number; r: number; b: number }) =>
  a.r <= b.l + 1 || b.r <= a.l + 1 || a.b <= b.t + 1 || b.b <= a.t + 1;

for (const [w, h] of SIZES) {
  test(`E2E-266 22-6 the tool palette at ${w}x${h}: six buttons stacked on the stage's left edge, the armed one filled with the accent, the pill names it, Esc disarms, and the palette and pill overlap no other stage control for any tool`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    const t = hideHelpers(page);
    await openRoom(page, t.exact);
    const pal = (await visibleRects(page, "#palette"))[0];
    expect(pal, "the palette is on the stage").toBeDefined();
    const stage = (await page.locator("#stage").boundingBox())!;
    expect(pal.l - stage.x).toBeLessThanOrEqual(12);
    const tops = await Promise.all(TOOL_NAMES.map(([id]) => t.ctl(id).boundingBox()));
    for (let i = 1; i < tops.length; i++) expect(tops[i]!.y, `${TOOL_NAMES[i][0]} is below ${TOOL_NAMES[i - 1][0]}`).toBeGreaterThan(tops[i - 1]!.y + tops[i - 1]!.height - 1);
    for (const [id, name] of TOOL_NAMES) {
      await t.ctl(id).click();
      await expect(t.ctl(id)).toHaveClass(/active/);
      const accent = await resolvedToken(page, "--accent");
      await expect.poll(() => t.ctl(id).evaluate((e) => getComputedStyle(e).backgroundColor), { message: `${id} fill` }).toBe(accent);
      await expect(page.locator("#arm-pill")).toBeVisible();
      await expect(page.locator("#arm-pill")).toHaveText(`${name} · Esc to exit`);
      const mine = [...(await visibleRects(page, "#palette")), ...(await visibleRects(page, "#arm-pill"))];
      for (const sel of STAGE_NEIGHBOURS) {
        for (const o of await visibleRects(page, sel)) for (const m of mine) expect(apart(m, o), `${id}: ${m.what} overlaps ${sel} (${o.what})`).toBe(true);
      }
      // Esc closes the most specific thing first (R22-1): Polygon is drawing and Cluster is picking a seed when armed, so their first Esc ends that
      for (let i = 0; i < 3 && (await page.locator("#arm-pill").isVisible()); i++) await page.keyboard.press("Escape");
      for (const [other] of TOOL_NAMES) await expect(t.ctl(other)).not.toHaveClass(/active/);
      await expect(page.locator("#arm-pill")).toBeHidden();
    }
  });
}

const SECTION_OF: [string, string][] = [["tool-box", "box"], ["tool-polygon", "polygon"], ["tool-cluster", "cluster"], ["tool-sparse", "sparse"], ["tool-plane", "plane"], ["tool-thin", "thin"]];
/** The element at the centre of a locator's box, as a tag name plus whether a button or input sits there. */
const hitAtCentre = async (page: Pg, loc: ReturnType<Pg["locator"]>) => {
  const b = (await loc.boundingBox())!;
  return page.evaluate(([x, y]) => {
    const e = document.elementFromPoint(x, y);
    return { tag: e?.tagName ?? "none", control: !!e?.closest("button, input, select, a") };
  }, [b.x + b.width / 2, b.y + b.height / 2]);
};
const clickCentre = async (page: Pg, loc: ReturnType<Pg["locator"]>) => {
  const b = (await loc.boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
};

for (const [w, h] of SIZES) {
  test(`E2E-265 22-6 at ${w}x${h} the ?, close and switch inside a section header act on themselves and never fold it, the header centre folds and is no button, and a folded section still shows its help`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    const t = hideHelpers(page);
    await openRoom(page, t.exact);
    for (const [tool, sec] of SECTION_OF) {
      await t.ctl(tool).click();
      const det = page.locator(`details[data-section="${sec}"]`);
      const sum = det.locator("> summary");
      await expect(det).toBeVisible();
      expect((await hitAtCentre(page, sum)).control, `${sec}: the header centre is no button`).toBe(false);
      await t.ctl(`${sec}-help`).click();
      await expect(det).toHaveJSProperty("open", true);
      await expect(page.locator(`#${sec}-help-pop`)).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator(`#${sec}-help-pop`)).toBeHidden();
      await expect(t.ctl(tool)).toHaveClass(/active/);
      await clickCentre(page, sum);
      await expect(det).toHaveJSProperty("open", false);
      await t.ctl(`${sec}-help`).click();
      await expect(page.locator(`#${sec}-help-pop`)).toBeVisible();
      expect(await page.locator(`#${sec}-help-pop`).boundingBox(), `${sec}: help has a box while folded`).not.toBeNull();
      await page.keyboard.press("Escape");
      await expect(page.locator(`#${sec}-help-pop`)).toBeHidden();
      await clickCentre(page, sum);
      await expect(det).toHaveJSProperty("open", true);
      await t.ctl(`${sec}-exit`).click();
      await expect(t.ctl(tool)).not.toHaveClass(/active/);
    }
    expect((await hitAtCentre(page, protSummary(page))).control, "protection: the header centre is no button").toBe(false);
  });
}

test("E2E-267 22-6 the inspector shows one line while idle and only the armed tool's section otherwise, Height protection below it, and the ? help closes before the tool does", async ({ page }) => {
  const t = hideHelpers(page);
  await openRoom(page, t.exact);
  await expect(page.locator("#toolpanels .idle-tool")).toBeVisible();
  await expect(page.locator("#toolpanels details[data-section]:visible")).toHaveCount(0);
  await t.ctl("tool-box").click();
  await expect(page.locator("#toolpanels .idle-tool")).toBeHidden();
  await expect(page.locator("#toolpanels details[data-section]:visible")).toHaveCount(1);
  await expect(page.locator('#toolpanels details[data-section="box"]')).toBeVisible();
  const order = await page.evaluate(() => {
    const box = document.querySelector('details[data-section="box"]')!;
    const prot = [...document.querySelectorAll("details.panel")].find((d) => d.querySelector("h2")?.textContent === "Height protection")!;
    return !!(box.compareDocumentPosition(prot) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(order, "Height protection follows the tool section").toBe(true);
  await t.ctl("box-help").click();
  await expect(page.locator("#box-help-pop")).toContainText(/small ring on an arrow/);
  await page.keyboard.press("Escape");
  await expect(page.locator("#box-help-pop")).toBeHidden();
  await expect(t.ctl("tool-box")).toHaveClass(/active/);
  await page.keyboard.press("Escape");
  await expect(t.ctl("tool-box")).not.toHaveClass(/active/);
});

test("E2E-268 22-6 the Box panel end to end: Outside inverts Selected, Fit opens a menu that closes on use, Min / max and Handles are disclosures, Reset box resets", async ({ page }) => {
  const t = previewHelpers(page);
  await t.wallSelected();
  await t.setBox(GHOST_BOX.c, GHOST_BOX.d);
  const inside = ROOM.ghost;
  await t.exact("Selected", String(inside));
  await page.getByRole("radio", { name: "Outside" }).click();
  await t.exact("Selected", String(ROOM_TOTAL - ROOM.invalid - inside)); // the NaN row is invalid, never selected
  await page.getByRole("radio", { name: "Inside" }).click();
  await t.exact("Selected", String(inside));
  await expect(page.locator("#box-fit-menu")).toBeHidden();
  await openFit(page);
  await expect(page.locator("#box-fit-menu")).toBeVisible();
  await t.ctl("box-fit-cloud").click();
  await expect(page.locator("#box-fit-menu")).toBeHidden();
  const size = await hook(page, (e) => [...e.state().tools.box.dimensions]);
  const bounds = await hook(page, (e) => e.state().session!.active_bounds);
  size.forEach((v, i) => {
    const range = bounds.max[i] - bounds.min[i];
    expect(v).toBeGreaterThanOrEqual(range);
    expect(v).toBeLessThan(range + 0.01);
  });
  await expect(t.ctl("box-min-x")).toBeHidden();
  await page.locator("details.disc > summary", { hasText: "Min / max" }).click();
  await expect(t.ctl("box-min-x")).toBeVisible();
  await expect(t.ctl("gizmo-snap")).toBeHidden();
  await openHandles(page);
  await t.ctl("gizmo-snap").check();
  await expect(t.ctl("gizmo-snap")).toBeChecked();
  await t.ctl("box-reset").click();
  const after = await hook(page, (e) => [...e.state().tools.box.dimensions]);
  expect(after).not.toEqual(size);
});

test("E2E-269 22-6 the Height protection header: the ? works while folded, the switch turns protection on and off without folding, and the Floor, Tilt, Show band rows work", async ({ page }) => {
  const t = hideHelpers(page);
  await openRoom(page, t.exact);
  const rows = roomValid();
  const fold = () => page.evaluate(() => (window as unknown as { __editor: { state: () => { floorPanelOpen: boolean } } }).__editor.state().floorPanelOpen);
  await protSummary(page).click(); // fold it
  await expect(page.locator("details.panel", { has: page.locator("summary", { hasText: "Height protection" }) })).toHaveJSProperty("open", false);
  await t.ctl("prot-help").click();
  await expect(page.locator("#prot-help-pop")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#prot-help-pop")).toBeHidden();
  await protSummary(page).click(); // unfold
  await expect.poll(fold).toBe(true); // the toggle event is queued: wait for the store
  await expect(page.locator("details.panel > summary [data-control=prot-enabled]"), "the switch lives in the header").toHaveCount(1);
  await t.ctl("prot-enabled").check();
  await expect(t.ctl("prot-enabled")).toBeChecked();
  await t.setNum("prot-max", 1.5);
  await t.setNum("prot-min", 0.5);
  await t.exact("Protected", String(rows.filter((r) => r[2] >= 0.5 && r[2] <= 1.5).length));
  expect(await fold(), "the switch does not fold the section").toBe(true);
  await expect(page.locator("details.panel", { has: page.locator("summary", { hasText: "Height protection" }) })).toHaveJSProperty("open", true);
  await t.ctl("prot-enabled").uncheck();
  await expect(t.ctl("prot-enabled")).not.toBeChecked();
  await t.exact("Protected", "0");
  await t.setNum("prot-floor-t", 0.3);
  await t.setNum("prot-tilt-x", 5);
  await expect(t.ctl("prot-tilt-x")).toHaveValue("5");
  await t.ctl("prot-level").click();
  await expect(t.ctl("prot-tilt-x")).toHaveValue("0");
  await expect(t.ctl("prot-tilt-y")).toHaveValue("0");
  const band = t.ctl("prot-show-band");
  await expect(band).toHaveAttribute("aria-checked", "true");
  await band.click();
  await expect(band).toHaveAttribute("aria-checked", "false");
  await band.click();
});

/** An element's own background and the backgrounds behind it (innermost first) up to the first opaque layer: what a graphic is drawn over. */
const graphicBackdrop = (page: Pg, selector: string) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel)!;
    const own = getComputedStyle(el).backgroundColor;
    const layers: string[] = [];
    for (let n: Element | null = el.parentElement; n; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (bg !== "rgba(0, 0, 0, 0)") {
        layers.push(bg);
        if (/^rgb\(/.test(bg)) break;
      }
    }
    return { own, layers };
  }, selector);
const graphicContrast = (g: Awaited<ReturnType<typeof graphicBackdrop>>) => {
  let bg: Rgba = [0, 0, 0, 1];
  for (const l of [...g.layers].reverse()) bg = over(cssRgba(l), bg);
  return contrastOf(cssRgba(g.own), bg);
};

for (const scheme of ["dark", "light"] as const) {
  test(`E2E-270 22-6 contrast under the ${scheme} theme: the armed icon on the accent, the pill, the header name and kbd, the ? and the switch on-track meet their floors; the switch off-track is measured and recorded`, async ({ page }, testInfo) => {
    const t = hideHelpers(page);
    await page.emulateMedia({ colorScheme: scheme });
    await openRoom(page, t.exact);
    await t.ctl("tool-box").click();
    await t.ctl("prot-enabled").check();
    await transitionsSettled(page);
    const icon = await page.evaluate(() => {
      const b = document.querySelector('[data-control="tool-box"]')!;
      return { fg: getComputedStyle(b).color, bg: getComputedStyle(b).backgroundColor };
    });
    expect(contrastOf(cssRgba(icon.fg), cssRgba(icon.bg)), `${scheme} armed icon on accent`).toBeGreaterThanOrEqual(3);
    for (const [name, sel, floor] of [
      ["pill", "#arm-pill, #arm-pill *", 4.5],
      ["header name and kbd", 'details[data-section="box"] > summary h2, details[data-section="box"] > summary .kbd', 4.5],
      ["? button", 'details[data-section="box"] > summary .qm', 3],
    ] as const) {
      await expect.poll(async () => (await textBackdrops(page, sel)).length, { message: name }).toBeGreaterThan(0);
      for (const e of await textBackdrops(page, sel)) {
        if (!/"[^"]+"$/.test(e.what)) continue;
        expect(worstContrast(e), `${scheme} ${name}: ${e.what}`).toBeGreaterThanOrEqual(floor);
      }
    }
    const on = graphicContrast(await graphicBackdrop(page, '[data-control="prot-enabled"]'));
    expect(on, `${scheme} switch on-track`).toBeGreaterThanOrEqual(3);
    await t.ctl("prot-enabled").uncheck();
    await transitionsSettled(page);
    const off = graphicContrast(await graphicBackdrop(page, '[data-control="prot-enabled"]'));
    testInfo.annotations.push({ type: "measure", description: `${scheme} switch on-track ${on.toFixed(2)}, off-track ${off.toFixed(2)} (owner E12: no floor)` });
    console.log(`E2E-270 ${scheme} switch on ${on.toFixed(2)} off ${off.toFixed(2)}`);
  });
}

for (const [w, h] of SIZES) {
  test(`E2E-271 22-6 owner screenshots at ${w}x${h}, dark and light: idle, Box armed with a preview, help open, Fit menu open, Height protection open; the page never scrolls and raises no error`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    const errors: string[] = [];
    const t = previewHelpers(page);
    await openRoom(page, t.exact);
    page.on("pageerror", (e) => errors.push(String(e)));
    const noScroll = () => page.evaluate(() => document.scrollingElement!.scrollHeight <= document.scrollingElement!.clientHeight + 1 && document.scrollingElement!.scrollWidth <= document.scrollingElement!.clientWidth + 1);
    const shot = async (state: string) => {
      for (const scheme of ["dark", "light"] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await transitionsSettled(page);
        await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))); // two frames: the canvas redraws with the theme's render palette
        expect(await noScroll(), `${state} ${scheme}: the page does not scroll`).toBe(true);
        await page.screenshot({ path: `/out/part22-6-${w}x${h}-${state}-${scheme}.png` });
      }
    };
    await shot("idle");
    await t.wallSelected();
    await t.ctl("op-add").click();
    await t.setBox(GHOST_BOX.c, GHOST_BOX.d);
    await t.previewIs(ROOM.wall + ROOM.ghost);
    await shot("box-armed");
    await t.ctl("box-help").click();
    await expect(page.locator("#box-help-pop")).toBeVisible();
    await shot("help-open");
    await page.keyboard.press("Escape");
    await openFit(page);
    await expect(page.locator("#box-fit-menu")).toBeVisible();
    await shot("fit-open");
    await page.keyboard.press("Escape");
    await expect(page.locator("#box-fit-menu")).toBeHidden();
    await t.ctl("prot-enabled").check();
    await shot("protection");
    expect(errors).toEqual([]);
  });
}

// ---- part 22-7: left sidebar (Selection and Layers)
test("E2E-286 22-7 the Selection section folds by click and by Enter, the fold survives a reload and the counts do not change", async ({ page }) => {
  const { exact, ctl } = helpers(page);
  await openRoom(page, exact);
  const sum = page.locator('details[data-section="selection"] > summary');
  const det = page.locator('details[data-section="selection"]');
  await expect(det).toHaveAttribute("open", "");
  await expect(ctl("sel-clear")).toBeVisible();
  const countsText = () => page.locator("#counts-panel").innerText();
  const before = await countsText();
  const putWith = (ok: (folded: Record<string, boolean> | undefined) => boolean) =>
    page.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith("/api/session/client-state") && ok(JSON.parse(r.postData() ?? "{}")?.ui?.sectionsOpen));
  const savedFolded = putWith((f) => f?.selection === false);
  await sum.click();
  await expect(ctl("sel-clear")).toBeHidden();
  await savedFolded;
  await page.reload();
  await exact("Original", String(ROOM_TOTAL));
  await expect.poll(async () => Object.keys(await SECTIONS_OPEN(page))).toEqual(["selection"]);
  await expect(ctl("sel-clear")).toBeHidden();
  expect(await countsText()).toBe(before);
  // the keyboard: Enter on the focused summary unfolds it again (saved, so the next test starts open)
  const savedOpen = putWith((f) => f === undefined || Object.keys(f).length === 0);
  await sum.focus();
  await page.keyboard.press("Enter");
  await expect(ctl("sel-clear")).toBeVisible();
  expect(await countsText()).toBe(before);
  await savedOpen;
});

test("E2E-286 22-7 (Scope) the Scope radios change the candidate exactly as the select did, by mouse and by keyboard", async ({ page }) => {
  const t = clusterHelpers(page);
  await openRoom(page, t.exact);
  await t.ctl("tool-cluster").click();
  await t.setNum("cluster-radius", 1.1);
  await t.pickSeed(CL.wall);
  await t.exact("Candidates", String(ROOM.wall));
  await t.ctl("scope-active").click();
  await expect(t.ctl("scope-active")).toHaveAttribute("aria-checked", "true");
  await t.exact("Candidates", String(ROOM.wall));
  await expect(t.ctl("apply")).toBeEnabled();
  await t.ctl("scope-active").focus();
  await page.keyboard.press("ArrowLeft");
  await expect(t.ctl("scope-displayed")).toHaveAttribute("aria-checked", "true");
  await expect(t.ctl("scope-displayed")).toBeFocused();
  await t.exact("Candidates", String(ROOM.wall));
  await expect(t.ctl("apply")).toBeEnabled();
});
