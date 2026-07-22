import { defineConfig, devices } from "@playwright/test";
import { E2E_ORIGINS } from "./scripts/e2e-config.mjs";

const productionGate = process.env.PLEROMA_PRODUCTION_GATE === "1";
const productionUrl = process.env.PLEROMA_PRODUCTION_URL;
const productionApiUrl = process.env.PLEROMA_PRODUCTION_API_URL;

if (productionGate && (!productionUrl || !productionApiUrl)) {
  throw new Error(
    "PLEROMA_PRODUCTION_URL and PLEROMA_PRODUCTION_API_URL are required when PLEROMA_PRODUCTION_GATE=1",
  );
}

// The stock Playwright lifecycle runs the real stack (Maker decision 2026-07-16, replacing
// the process-ownership harness): the worker script migrates an isolated D1 and execs
// `wrangler dev`; the web command builds against that Worker and serves the built copy.
// `reuseExistingServer: false` fails fast on a busy port, which is the concurrency guard.
export default defineConfig({
  testDir: "./e2e",
  testMatch: productionGate ? /(?:ignition\.live|launch\.checklist)\.spec\.ts/ : undefined,
  testIgnore: productionGate ? undefined : ["**/ignition.live.spec.ts", "**/launch.checklist.spec.ts"],
  workers: 1,
  // The shared CI runner is a 2-core box with no GPU: real-stack pipeline polls, sticky-layout
  // measurement, and media playback all run several times slower than any dev machine, so CI gets
  // wider budgets and two retries. Retries re-run the complete real test and Playwright reports a
  // pass-on-retry as "flaky" (visible, never silent); a genuine regression still fails every
  // attempt and reds the run. Local runs keep the strict budgets and zero retries.
  retries: process.env.CI ? 2 : 0,
  timeout: process.env.CI ? 60_000 : 30_000,
  expect: { timeout: process.env.CI ? 10_000 : 5_000 },
  use: { baseURL: productionGate ? productionUrl : E2E_ORIGINS.web },
  webServer: productionGate ? undefined : [
    {
      command: "node scripts/e2e-worker.mjs",
      url: `${E2E_ORIGINS.worker}/api/health`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: `npm run build && npx vite preview --host localhost --port 4173 --strictPort`,
      url: `${E2E_ORIGINS.web}/`,
      reuseExistingServer: false,
      timeout: 240_000,
      env: { VITE_API_BASE: E2E_ORIGINS.worker },
    },
  ],
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "mobile-390", use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } } },
  ],
});
