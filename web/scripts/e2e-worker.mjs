import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  E2E_ORIGINS,
  E2E_PORTS,
  REPOSITORY_ROOT,
  TEST_PULSE_MINT,
  WORKER_ROOT,
  assertSafePersistencePath,
} from "./e2e-config.mjs";

// The worker half of the E2E stack, run as a Playwright webServer command: compile the
// Doctrine, start from a clean isolated persistence directory, apply real D1 migrations,
// then exec `wrangler dev`. Playwright owns this process tree — it waits on /api/health and
// kills the tree when the run ends. No fabricated responses anywhere: this is the real
// Worker against real local D1/R2.
const WRANGLER_CLI = path.resolve(WORKER_ROOT, "node_modules/wrangler/bin/wrangler.js");

function writeE2EWranglerConfig(persistencePath) {
  const source = readFileSync(path.resolve(WORKER_ROOT, "wrangler.toml"), "utf8");
  const mainDeclaration = /^main = "src\/index\.ts"$/gm;
  if ([...source.matchAll(mainDeclaration)].length !== 1) {
    throw new Error("E2E Wrangler config expected one authoritative Worker main declaration");
  }
  const configPath = path.resolve(persistencePath, "wrangler.e2e.toml");
  const config = source.replace(
    mainDeclaration,
    `main = ${JSON.stringify(path.resolve(WORKER_ROOT, "src/index.ts").replaceAll("\\", "/"))}`,
  );
  writeFileSync(configPath, config);
  return configPath;
}

const persistencePath = assertSafePersistencePath();
rmSync(persistencePath, { recursive: true, force: true });
mkdirSync(persistencePath, { recursive: true });

execFileSync(process.execPath, [path.resolve(REPOSITORY_ROOT, "worker/scripts/compile-doctrine.mjs")], {
  cwd: WORKER_ROOT,
  stdio: "inherit",
});
const configPath = writeE2EWranglerConfig(persistencePath);
// Migrations run against the worker's own wrangler.toml (cwd WORKER_ROOT) so the migrations
// directory resolves correctly; only `wrangler dev` needs the generated config's absolute main.
execFileSync(process.execPath, [
  WRANGLER_CLI,
  "d1", "migrations", "apply", "pleroma",
  "--local",
  "--persist-to", persistencePath,
], { cwd: WORKER_ROOT, stdio: "inherit", env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" } });

const wrangler = spawn(process.execPath, [
  WRANGLER_CLI,
  "dev",
  "--local",
  "--config", configPath,
  "--port", String(E2E_PORTS.worker),
  "--persist-to", persistencePath,
  "--var", `CORS_ORIGIN:${E2E_ORIGINS.web}`,
  "--var", `PULSE_MINT:${TEST_PULSE_MINT}`,
], {
  cwd: WORKER_ROOT,
  stdio: "inherit",
  env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" },
});
wrangler.on("exit", (code) => process.exit(code ?? 1));
