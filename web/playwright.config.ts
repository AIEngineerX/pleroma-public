import { defineConfig, devices } from "@playwright/test";

const productionGate = process.env.PLEROMA_PRODUCTION_GATE === "1";
const productionUrl = process.env.PLEROMA_PRODUCTION_URL;
const productionApiUrl = process.env.PLEROMA_PRODUCTION_API_URL;

if (productionGate && (!productionUrl || !productionApiUrl)) {
  throw new Error(
    "PLEROMA_PRODUCTION_URL and PLEROMA_PRODUCTION_API_URL are required when PLEROMA_PRODUCTION_GATE=1",
  );
}

export default defineConfig({
  testDir: "./e2e",
  globalTeardown: productionGate ? undefined : "./e2e/globalTeardown.ts",
  testMatch: productionGate ? /(?:ignition\.live|launch\.checklist)\.spec\.ts/ : undefined,
  testIgnore: productionGate ? undefined : ["**/ignition.live.spec.ts", "**/launch.checklist.spec.ts"],
  webServer: productionGate ? undefined : {
    command: "node scripts/e2e-stack.mjs",
    url: "http://localhost:4173/",
    reuseExistingServer: false,
    timeout: 180_000,
  },
  workers: 1,
  use: { baseURL: productionGate ? productionUrl : "http://localhost:4173" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "mobile-390", use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } } },
  ],
});
