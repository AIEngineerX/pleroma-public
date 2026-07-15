import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "e2e-orphan-playwright.spec.mjs",
  workers: 1,
  projects: [{ name: "runner-orphan" }],
});
