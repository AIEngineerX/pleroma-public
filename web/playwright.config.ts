import { defineConfig, devices } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { assertRunToken, e2eOrigins, readE2EPorts } from "./scripts/e2e-run-ownership.mjs";

const productionGate = process.env.PLEROMA_PRODUCTION_GATE === "1";
const productionUrl = process.env.PLEROMA_PRODUCTION_URL;
const productionApiUrl = process.env.PLEROMA_PRODUCTION_API_URL;

if (productionGate && (!productionUrl || !productionApiUrl)) {
  throw new Error(
    "PLEROMA_PRODUCTION_URL and PLEROMA_PRODUCTION_API_URL are required when PLEROMA_PRODUCTION_GATE=1",
  );
}

const inheritedRunToken = process.env.PLEROMA_E2E_RUN_TOKEN;
const e2eRunToken = productionGate
  ? null
  : inheritedRunToken === undefined
    ? randomBytes(32).toString("hex")
    : assertRunToken(inheritedRunToken);
const e2ePorts = readE2EPorts(productionGate ? {} : process.env);
const localOrigins = e2eOrigins(e2ePorts);
if (e2eRunToken !== null) {
  process.env.PLEROMA_E2E_RUN_TOKEN = e2eRunToken;
  process.env.PLEROMA_E2E_WEB_PORT = String(e2ePorts.web);
  process.env.PLEROMA_E2E_WORKER_PORT = String(e2ePorts.worker);
}

export default defineConfig({
  testDir: "./e2e",
  globalTeardown: productionGate ? undefined : "./e2e/globalTeardown.ts",
  testMatch: productionGate ? /(?:ignition\.live|launch\.checklist)\.spec\.ts/ : undefined,
  testIgnore: productionGate ? undefined : ["**/ignition.live.spec.ts", "**/launch.checklist.spec.ts"],
  webServer: productionGate ? undefined : {
    command: `node scripts/e2e-stack.mjs --pleroma-e2e-owner=${e2eRunToken} --pleroma-e2e-role=harness --pleroma-e2e-web-port=${e2ePorts.web} --pleroma-e2e-worker-port=${e2ePorts.worker}`,
    url: `${localOrigins.web}/`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
  workers: 1,
  use: { baseURL: productionGate ? productionUrl : localOrigins.web },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "mobile-390", use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } } },
  ],
});
