import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "e2e-blocked-playwright.spec.mjs",
  workers: 1,
  projects: [{ name: "runner-cancellation" }],
});
