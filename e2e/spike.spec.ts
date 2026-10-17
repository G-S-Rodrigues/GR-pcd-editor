import { test, expect } from "@playwright/test";

test("WebGL context is available and the viewport canvas is not blank", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(1000);
  const renderer = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    return gl ? String(gl.getParameter(gl.VERSION)) : null;
  });
  expect(renderer).not.toBeNull();
  const png = await page.locator("#viewport").screenshot();
  console.log("webgl", renderer, "viewport png bytes", png.length);
  // a flat single-colour canvas compresses to a few hundred bytes
  expect(png.length).toBeGreaterThan(3000);
});
