import { defineConfig, devices } from "@playwright/test";
// Screenshots run against the built site served by `vite preview` (port 4173). Specs that need live data
// spin the local Worker separately (documented per-spec) — the day-6 rehearsal wires the full stack.
export default defineConfig({
  testDir: "./e2e",
  webServer: { command: "vite preview --port 4173", port: 4173, reuseExistingServer: !process.env.CI },
  use: { baseURL: "http://localhost:4173" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "mobile-390", use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } } },
  ],
});
