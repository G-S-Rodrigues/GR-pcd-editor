import { expect, test } from "@playwright/test";
import { FLOOR, GHOST, TOTAL, syntheticPcd } from "./synthetic";

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
