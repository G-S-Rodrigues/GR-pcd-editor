import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

// README screenshots of a real scan. Manual tool, not part of the smoke run or any gate: it needs a PCD you own.
//   GR_PCD_SHOTS_PCD=/abs/path/cloud.pcd SMOKE_SHOTS_DIR=<dir> bash scripts/smoke.sh npx playwright test -c shots.config.ts --workers=1
// scripts/smoke.sh mounts the file read-only at /in/cloud.pcd. Output goes only to /out (copied to SMOKE_SHOTS_DIR).

const ctl = (page: Page, id: string) => page.locator(`[data-control="${id}"]`); // as helpers() in smoke.spec.ts
// as transitionsSettled in smoke.spec.ts, then two frames so the canvas redraws with the theme's render palette
async function settle(page: Page) {
  await expect.poll(() => page.evaluate(() => document.getAnimations().length), { message: "CSS transitions finished" }).toBe(0);
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}
const POP_ANCHOR: Record<string, string> = { display: "display-open", details: "details-open", help: "help", history: "history-open" }; // as openPop in smoke.spec.ts
async function openPop(page: Page, id: string) {
  const a = page.locator(`[data-control="${POP_ANCHOR[id]}"]`);
  if ((await a.getAttribute("aria-expanded")) !== "true") await a.click();
  await expect(a).toHaveAttribute("aria-expanded", "true");
}
const stat = (page: Page, name: string) => page.locator(`[data-status="${name}"]`);

function loadScan() {
  const file = process.env.GR_PCD_SHOTS_PCD;
  if (!file) throw new Error("GR_PCD_SHOTS_PCD is not set: run through scripts/smoke.sh with GR_PCD_SHOTS_PCD=/absolute/path/to/cloud.pcd");
  const buffer = readFileSync(file);
  const head = buffer.subarray(0, 2048).toString("latin1");
  const points = Number(/^POINTS\s+(\d+)/m.exec(head)?.[1]);
  if (!Number.isFinite(points) || points <= 0) throw new Error(`no POINTS in the PCD header of ${file}`);
  return { name: basename(file), buffer, points };
}

test("README shots: probe", async ({ page }) => {
  const scan = loadScan();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await page.locator("#file-input").setInputFiles({ name: scan.name, mimeType: "application/octet-stream", buffer: scan.buffer });
  await expect(page.locator('#cloud-details [data-status="Original"]')).toContainText(scan.points.toLocaleString("en-US"), { timeout: 60_000 });
  console.log("SHOTS original", await page.locator('#cloud-details [data-status="Original"]').textContent(), "header", scan.points);
  await page.mouse.move(5, 5);
  await settle(page);
  await page.screenshot({ path: "/out/1280x720-dark-idle.png" });
  await ctl(page, "tool-box").click();
  await expect(page.locator("#arm-pill")).toBeVisible();
  await settle(page);
  console.log("SHOTS selected", await stat(page, "Selected").textContent());
  void openPop;
  expect(errors).toEqual([]);
});
