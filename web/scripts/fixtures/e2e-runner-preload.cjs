const { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");

const mode = process.env.PLEROMA_E2E_PRELOAD_MODE;
const readyPath = process.env.PLEROMA_E2E_PRELOAD_READY;
const releasePath = process.env.PLEROMA_E2E_PRELOAD_RELEASE;
const manifestPath = process.env.PLEROMA_E2E_PRELOAD_MANIFEST;
const targetPath = process.env.PLEROMA_E2E_PRELOAD_TARGET;
const backupPath = process.env.PLEROMA_E2E_PRELOAD_BACKUP;
const wrapperReadyPath = process.env.PLEROMA_E2E_PRELOAD_WRAPPER_READY;
const scriptPath = (process.argv[1] ?? "").replaceAll("\\", "/");
const normalizedArguments = process.argv.slice(2).map((value) => value.replaceAll("\\", "/"));

function collideWithManifest() {
  const manifest = readFileSync(manifestPath, "utf8");
  writeFileSync(backupPath, manifest, { flag: "wx" });
  rmSync(manifestPath);
  mkdirSync(manifestPath);
}

if (
  mode === "record-playwright-root"
  && readyPath
  && scriptPath.endsWith("/node_modules/@playwright/test/cli.js")
) {
  writeFileSync(readyPath, JSON.stringify({ pid: process.pid }));
}

if (mode === "collide-launch-manifest" && targetPath && scriptPath.endsWith("/scripts/e2e-stack.mjs")) {
  writeFileSync(targetPath, JSON.stringify({ pid: process.pid }));
}

if (
  mode === "collide-launch-manifest"
  && readyPath
  && manifestPath
  && scriptPath.endsWith("/scripts/e2e-launch-gate.mjs")
) {
  mkdirSync(manifestPath);
  writeFileSync(readyPath, JSON.stringify({ pid: process.pid }));
}

if (
  mode === "block-launch-gate-before-ready"
  && readyPath
  && releasePath
  && scriptPath.endsWith("/scripts/e2e-launch-gate.mjs")
) {
  writeFileSync(readyPath, JSON.stringify({ pid: process.pid }));
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  while (!existsSync(releasePath)) Atomics.wait(sleeper, 0, 0, 50);
}

if (
  mode === "block-launch-gate-before-ready"
  && targetPath
  && scriptPath.endsWith("/scripts/e2e-stack.mjs")
) {
  writeFileSync(targetPath, JSON.stringify({ pid: process.pid }));
}

if (
  mode === "collide-service-manifest"
  && manifestPath
  && backupPath
  && wrapperReadyPath
  && scriptPath.endsWith("/scripts/e2e-managed-command.mjs")
  && normalizedArguments[0]?.endsWith("/worker/node_modules/wrangler/bin/wrangler.js")
  && normalizedArguments[1] === "dev"
) {
  collideWithManifest();
  writeFileSync(wrapperReadyPath, JSON.stringify({ pid: process.pid }));
}

if (
  mode === "collide-service-manifest"
  && manifestPath
  && backupPath
  && targetPath
  && scriptPath.endsWith("/worker/node_modules/wrangler/bin/wrangler.js")
  && normalizedArguments[0] === "dev"
) {
  writeFileSync(targetPath, JSON.stringify({ pid: process.pid }));
  collideWithManifest();
  throw new Error("service target executed before manifest publication completed");
}

if (
  mode === "block-stack-before-owner"
  && readyPath
  && releasePath
  && scriptPath.endsWith("/scripts/e2e-stack.mjs")
) {
  writeFileSync(readyPath, JSON.stringify({ pid: process.pid }));
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  while (!existsSync(releasePath)) Atomics.wait(sleeper, 0, 0, 50);
}
