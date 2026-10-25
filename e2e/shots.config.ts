import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// The README shots tool (readme.shots.ts). Separate from the smoke run: the default config only matches *.spec.ts,
// so this file's tests never join the smoke count or CI. It keeps the base outputDir, reporter and projects.
export default defineConfig({ ...base, testMatch: /.*\.shots\.ts/ });
