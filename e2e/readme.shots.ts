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

// The server keeps the previous test's session and a page load adopts it (as beforeEach in smoke.spec.ts): start every shot clean.
test.beforeEach(async ({ request }) => {
  await request.delete("/api/session");
});

const SIZES = [{ w: 1280, h: 720 }, { w: 1920, h: 1080 }] as const;
const SCHEMES = ["dark", "light"] as const;

// Each (size, scheme) is a fresh page load so every state starts from the same place. The three committed states (R22-20: only
// the 1920x1080 ones are copied into the repo) are idle, armed and draft; the owner-only states (menu, details, bandhidden) are
// taken in the dark scheme only and stay in the scratch shots folder. Every required step fails loudly.
for (const size of SIZES) {
  for (const scheme of SCHEMES) {
    test(`README shots: ${size.w}x${size.h} ${scheme}`, async ({ page }) => {
      test.setTimeout(300_000);
      const scan = loadScan();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("console", (m) => {
        if (m.type() === "error" && !/404/.test(m.text())) errors.push(m.text()); // the startup 404 rule from E2E-01
      });
      const shot = async (state: string) => {
        await page.mouse.move(5, 5);
        await settle(page);
        await page.screenshot({ path: `/out/${size.w}x${size.h}-${scheme}-${state}.png` });
      };
      await page.setViewportSize({ width: size.w, height: size.h });
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/");
      await page.locator("#file-input").setInputFiles({ name: "unitree_slam.pcd", mimeType: "application/octet-stream", buffer: scan.buffer });
      // a wrong Original count fails here: the scan must be the 134,674 point owner cloud
      expect(scan.points, "POINTS in the PCD header").toBe(134674);
      await expect(stat(page, "Original")).toContainText("134,674", { timeout: 60_000 });
      await settle(page);
      await shot("idle");

      await ctl(page, "tool-box").click();
      await expect(page.locator("#arm-pill")).toBeVisible();
      await expect.poll(async () => Number(((await stat(page, "Selected").textContent()) ?? "").replace(/[^0-9]/g, "")), { message: "Selected > 0", timeout: 30_000 }).toBeGreaterThan(0);
      await shot("armed");

      const num = async (id: string) => Number(await ctl(page, id).inputValue());
      await ctl(page, "op-add").click();
      const cx = await num("box-center-x");
      const sx = await num("box-size-x");
      await ctl(page, "box-center-x").fill(String(cx + sx));
      await ctl(page, "box-center-x").press("Enter");
      await expect(page.locator("#draft-note")).toContainText("Preview, not applied", { timeout: 30_000 });
      await ctl(page, "box-center-x").blur(); // no focus ring on the edited field
      await shot("draft");

      if (scheme === "dark") {
        await openPop(page, "details");
        await shot("owner-details");
        await page.keyboard.press("Escape");
        await ctl(page, "sel-discard").click();
        await expect(page.locator("#draft-note")).toBeHidden({ timeout: 15_000 });
        await ctl(page, "layer-name").fill("Area");
        await ctl(page, "layer-new").click();
        const more = page.locator("[data-layer-more]").first();
        await more.click();
        await expect(page.locator("#layer-menu")).toBeVisible();
        await shot("owner-menu");
        await page.keyboard.press("Escape");
        // Height protection with the band hidden: the pill shows
        const sw = page.locator("#prot-show-band");
        if (await sw.count()) {
          if (!(await sw.isVisible())) await page.locator("details.panel > summary", { hasText: "Height protection" }).click({ timeout: 10_000 });
          const on = page.locator("#prot-enabled");
          if (!(await on.isChecked())) await on.check({ timeout: 10_000 });
          if ((await sw.getAttribute("aria-checked")) === "true") await sw.click({ timeout: 10_000 });
          await expect(page.locator("#band-pill")).toBeVisible();
          await shot("owner-bandhidden");
        }
      }
      expect(errors).toEqual([]);
    });
  }
}
