import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  timeout: 120_000,
  reporter: "list",
  outputDir: "/tmp/pw-results",
  use: {
    baseURL: "http://localhost:8080",
    viewport: { width: 1400, height: 900 },
    // Playwright emulates "light" by default; the app follows prefers-color-scheme (part 22-4). Light tests opt in with page.emulateMedia.
    colorScheme: "dark",
    launchOptions: {
      args: [
        "--use-angle=swiftshader",
        "--use-gl=angle",
        "--enable-unsafe-swiftshader",
        "--ignore-gpu-blocklist",
      ],
    },
  },
});
