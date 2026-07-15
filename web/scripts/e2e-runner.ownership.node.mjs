import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  E2E_PERSIST_PATH,
  E2E_TMP_ROOT,
  acquireRunPersistence,
  directoryBelongsToRun,
  isProcessAlive,
  ownershipPaths,
  processIdentityMarker,
  readOwnedManifest,
  teardownOwnedRun,
  writeRunManifest,
} from "./e2e-run-ownership.mjs";

const SCRIPT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(SCRIPT_ROOT, "..");
const REPOSITORY_ROOT = path.resolve(WEB_ROOT, "..");
const PLAYWRIGHT_CLI = path.resolve(WEB_ROOT, "node_modules/@playwright/test/cli.js");
const RUNNER_PRELOAD = path.resolve(SCRIPT_ROOT, "fixtures/e2e-runner-preload.cjs");
const BLOCKED_STARTUP = path.resolve(SCRIPT_ROOT, "fixtures/e2e-blocked-startup.mjs");
const EXITED_STARTUP = path.resolve(SCRIPT_ROOT, "fixtures/e2e-exited-startup.mjs");
const BLOCKED_PLAYWRIGHT_CONFIG = path.resolve(
  SCRIPT_ROOT,
  "fixtures/e2e-blocked-playwright.config.mjs",
);
const ORPHAN_PLAYWRIGHT_CONFIG = path.resolve(
  SCRIPT_ROOT,
  "fixtures/e2e-orphan-playwright.config.mjs",
);
const WINDOWS_JOB_HOST = path.resolve(SCRIPT_ROOT, "e2e-windows-job.ps1");
const JOB_ARGS_FIXTURE = path.resolve(SCRIPT_ROOT, "fixtures/e2e-job-args.mjs");

function runToken() {
  return randomBytes(32).toString("hex");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function settleWithin(promise, timeoutMs) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve({ type: "timeout" }), timeoutMs);
    promise.then((result) => {
      clearTimeout(timeout);
      resolve(result);
    });
  });
}

async function waitUntil(predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(25);
  }
  assert.fail("timed out waiting for runner lifecycle state");
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function unusedPort() {
  const server = net.createServer();
  await listen(server, 0, "127.0.0.1");
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  await close(server);
  return address.port;
}

async function unusedPorts() {
  const webServer = net.createServer();
  const workerServer = net.createServer();
  try {
    await listen(webServer, 0, "127.0.0.1");
    await listen(workerServer, 0, "127.0.0.1");
    const webAddress = webServer.address();
    const workerAddress = workerServer.address();
    assert.notEqual(webAddress, null);
    assert.notEqual(workerAddress, null);
    assert.equal(typeof webAddress, "object");
    assert.equal(typeof workerAddress, "object");
    assert.notEqual(webAddress.port, workerAddress.port);
    return { web: webAddress.port, worker: workerAddress.port };
  } finally {
    if (webServer.listening) await close(webServer);
    if (workerServer.listening) await close(workerServer);
  }
}

async function assertPortsReleased(ports) {
  const webProbe = net.createServer();
  const workerProbe = net.createServer();
  try {
    await listen(webProbe, ports.web, "127.0.0.1");
    await listen(workerProbe, ports.worker, "127.0.0.1");
  } finally {
    if (webProbe.listening) await close(webProbe);
    if (workerProbe.listening) await close(workerProbe);
  }
}

function assertNoRunnerOwnershipPaths() {
  const names = existsSync(E2E_TMP_ROOT) ? readdirSync(E2E_TMP_ROOT) : [];
  assert.deepEqual(
    names.filter((name) => name.startsWith("e2e-runner-")),
    [],
    "runner-owned launch persistence survived settlement",
  );
}

async function stopPid(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || !isProcessAlive(pid)) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline && isProcessAlive(pid)) await delay(25);
  if (!isProcessAlive(pid)) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
  await waitUntil(() => !isProcessAlive(pid));
}

function preloadNodeOptions(env = process.env) {
  const preload = `--require=${RUNNER_PRELOAD.replaceAll("\\", "/")}`;
  return [env.NODE_OPTIONS, preload].filter(Boolean).join(" ");
}

function readPidFixture(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function acquisitionIdFor(persistencePath) {
  try {
    const owner = JSON.parse(readFileSync(ownershipPaths(persistencePath).ownerPath, "utf8"));
    return typeof owner.acquisitionId === "string" ? owner.acquisitionId : null;
  } catch {
    return null;
  }
}

function readManifestFor(persistencePath, token, ports) {
  const acquisitionId = acquisitionIdFor(persistencePath);
  return acquisitionId === null
    ? null
    : readOwnedManifest(persistencePath, token, ports, acquisitionId);
}

function belongsToAcquisition(persistencePath, token, ports) {
  const acquisitionId = acquisitionIdFor(persistencePath);
  return acquisitionId !== null
    && directoryBelongsToRun(persistencePath, token, ports, acquisitionId);
}

function npmExecPath() {
  if (process.env.npm_execpath) return process.env.npm_execpath;
  const bundled = path.resolve(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
  assert.equal(existsSync(bundled), true, `npm CLI not found at ${bundled}`);
  return bundled;
}

async function loadRunner() {
  return import("./e2e-runner.mjs");
}

test("the npm E2E runtime is project-owned instead of Playwright webServer-owned", () => {
  const packageJson = JSON.parse(readFileSync(path.resolve(WEB_ROOT, "package.json"), "utf8"));
  const config = readFileSync(path.resolve(WEB_ROOT, "playwright.config.ts"), "utf8");
  assert.equal(packageJson.scripts.e2e, "node scripts/e2e-runner.mjs");
  assert.doesNotMatch(config, /^\s*webServer\s*:/m);
  assert.doesNotMatch(config, /^\s*globalTeardown\s*:/m);
});

test("Windows Job host preserves target arguments and waits for an empty job", (context) => {
  if (process.platform !== "win32") {
    context.skip("Windows Job host argument fidelity is Windows-specific");
    return;
  }
  const token = runToken();
  const fixtureRoot = path.resolve(E2E_TMP_ROOT, `job-args-${token}`);
  const outputPath = path.resolve(fixtureRoot, "arguments.json");
  const expectedArguments = [
    "alpha",
    "value with spaces",
    'quote"value',
    "trailing\\",
    "",
  ];
  mkdirSync(fixtureRoot, { recursive: true });

  try {
    const targetArguments = [JOB_ARGS_FIXTURE, outputPath, ...expectedArguments];
    const result = spawnSync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy", "Bypass",
      "-File", WINDOWS_JOB_HOST,
      process.execPath,
      WEB_ROOT,
      Buffer.from(JSON.stringify(targetArguments), "utf8").toString("base64"),
    ], {
      cwd: WEB_ROOT,
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
    });

    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.signal, null, result.stderr);
    assert.equal(result.status, 0, result.stderr);
    const fixture = readPidFixture(outputPath);
    assert.deepEqual(fixture.argumentsReceived, expectedArguments);
    assert.equal(isProcessAlive(fixture.pid), false, "target survived completed Job host");
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("manifest publication failure retires the inert gate before target execution", async () => {
  if (existsSync(E2E_PERSIST_PATH)) return;
  const token = runToken();
  const ports = await unusedPorts();
  const fixtureRoot = path.resolve(E2E_TMP_ROOT, `manifest-failure-${token}`);
  const readyPath = path.resolve(fixtureRoot, "gate-ready.json");
  const targetPath = path.resolve(fixtureRoot, "target-ran.json");
  const launchPath = path.resolve(E2E_TMP_ROOT, `e2e-runner-stack-${token}`);
  const manifestPath = ownershipPaths(launchPath).manifestPath;
  let fixture = null;
  mkdirSync(fixtureRoot, { recursive: true });
  const { runOwnedE2E } = await loadRunner();
  const running = runOwnedE2E({
    env: {
      ...process.env,
      NODE_OPTIONS: preloadNodeOptions(),
      PLEROMA_E2E_PRELOAD_MODE: "collide-launch-manifest",
      PLEROMA_E2E_PRELOAD_READY: readyPath,
      PLEROMA_E2E_PRELOAD_MANIFEST: manifestPath,
      PLEROMA_E2E_PRELOAD_TARGET: targetPath,
      PLEROMA_E2E_RUN_TOKEN: token,
      PLEROMA_E2E_WEB_PORT: String(ports.web),
      PLEROMA_E2E_WORKER_PORT: String(ports.worker),
      npm_execpath: npmExecPath(),
    },
    playwrightArgs: ["--list"],
  });

  try {
    await assert.rejects(running);
    assert.equal(
      existsSync(readyPath),
      true,
      "gate did not create the real manifest-path collision before publication",
    );
    fixture = readPidFixture(readyPath);
    assert.equal(isProcessAlive(fixture.pid), false, "inert launch gate survived publication failure");
    assert.equal(existsSync(targetPath), false, "target executed without a published manifest");
    assert.equal(existsSync(launchPath), false);
  } finally {
    await running.catch(() => {});
    if (fixture !== null) await stopPid(fixture.pid);
    rmSync(launchPath, { recursive: true, force: true });
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("cancellation while the launch gate is not ready never starts the target", async (context) => {
  if (existsSync(E2E_PERSIST_PATH)) {
    context.skip("the fixed E2E persistence path already belongs to another run");
    return;
  }
  const token = runToken();
  const ports = await unusedPorts();
  const fixtureRoot = path.resolve(E2E_TMP_ROOT, `gate-ready-abort-${token}`);
  const readyPath = path.resolve(fixtureRoot, "gate.json");
  const releasePath = path.resolve(fixtureRoot, "release");
  const targetPath = path.resolve(fixtureRoot, "target.json");
  const launchPath = path.resolve(E2E_TMP_ROOT, `e2e-runner-stack-${token}`);
  const controller = new AbortController();
  let fixture = null;
  mkdirSync(fixtureRoot, { recursive: true });
  const { runOwnedE2E } = await loadRunner();
  const running = runOwnedE2E({
    env: {
      ...process.env,
      NODE_OPTIONS: preloadNodeOptions(),
      PLEROMA_E2E_PRELOAD_MODE: "block-launch-gate-before-ready",
      PLEROMA_E2E_PRELOAD_READY: readyPath,
      PLEROMA_E2E_PRELOAD_RELEASE: releasePath,
      PLEROMA_E2E_PRELOAD_TARGET: targetPath,
      PLEROMA_E2E_RUN_TOKEN: token,
      PLEROMA_E2E_WEB_PORT: String(ports.web),
      PLEROMA_E2E_WORKER_PORT: String(ports.worker),
      npm_execpath: npmExecPath(),
    },
    playwrightArgs: ["--list"],
    signal: controller.signal,
  });
  let outcome;

  try {
    await waitUntil(() => existsSync(readyPath));
    fixture = readPidFixture(readyPath);
    controller.abort();
    outcome = await settleWithin(
      running.then(
        (code) => ({ type: "resolved", code }),
        (error) => ({ type: "rejected", error }),
      ),
      2_000,
    );
  } finally {
    if (outcome?.type === "timeout") writeFileSync(releasePath, "release\n");
    await running.catch(() => {});
    if (fixture !== null) await stopPid(fixture.pid);
  }

  try {
    assert.equal(outcome?.type, "rejected", "runner ignored abort while gate readiness was blocked");
    assert.equal(outcome.error?.name, "AbortError");
    assert.equal(isProcessAlive(fixture.pid), false, "blocked inert gate survived cancellation");
    assert.equal(existsSync(targetPath), false, "target started after cancellation");
    assert.equal(existsSync(launchPath), false);
  } finally {
    rmSync(launchPath, { recursive: true, force: true });
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("persistent service target never starts when descriptor publication fails", async (context) => {
  if (existsSync(E2E_PERSIST_PATH)) {
    context.skip("the fixed E2E persistence path already belongs to another run");
    return;
  }
  const token = runToken();
  const ports = await unusedPorts();
  const fixtureRoot = path.resolve(E2E_TMP_ROOT, `service-publication-${token}`);
  const manifestPath = ownershipPaths(E2E_PERSIST_PATH).manifestPath;
  const backupPath = path.resolve(fixtureRoot, "manifest-backup.json");
  const wrapperReadyPath = path.resolve(fixtureRoot, "wrapper.json");
  const targetPath = path.resolve(fixtureRoot, "target.json");
  mkdirSync(fixtureRoot, { recursive: true });
  const { runOwnedE2E } = await loadRunner();
  let wrapperFixture = null;
  let targetFixture = null;
  let cleanupResult = null;

  try {
    await assert.rejects(runOwnedE2E({
      env: {
        ...process.env,
        NODE_OPTIONS: preloadNodeOptions(),
        PLEROMA_E2E_PRELOAD_MODE: "collide-service-manifest",
        PLEROMA_E2E_PRELOAD_MANIFEST: manifestPath,
        PLEROMA_E2E_PRELOAD_BACKUP: backupPath,
        PLEROMA_E2E_PRELOAD_WRAPPER_READY: wrapperReadyPath,
        PLEROMA_E2E_PRELOAD_TARGET: targetPath,
        PLEROMA_E2E_RUN_TOKEN: token,
        PLEROMA_E2E_WEB_PORT: String(ports.web),
        PLEROMA_E2E_WORKER_PORT: String(ports.worker),
        npm_execpath: npmExecPath(),
      },
      playwrightArgs: ["--list"],
    }));
    if (existsSync(wrapperReadyPath)) wrapperFixture = readPidFixture(wrapperReadyPath);
    if (existsSync(targetPath)) targetFixture = readPidFixture(targetPath);

    assert.equal(existsSync(backupPath), true, "service launch never reached the real manifest collision");
    const owner = JSON.parse(readFileSync(ownershipPaths(E2E_PERSIST_PATH).ownerPath, "utf8"));
    assert.equal(owner.runToken, token);
    assert.deepEqual(owner.ports, ports);
    if (wrapperFixture !== null) await stopPid(wrapperFixture.pid);
    if (targetFixture !== null) await stopPid(targetFixture.pid);
    assert.equal(isProcessAlive(wrapperFixture?.pid), false);
    assert.equal(isProcessAlive(targetFixture?.pid), false);
    rmSync(manifestPath, { recursive: true, force: true });
    writeFileSync(manifestPath, readFileSync(backupPath, "utf8"), { flag: "wx" });
    cleanupResult = await teardownOwnedRun({
      persistencePath: E2E_PERSIST_PATH,
      runToken: token,
      acquisitionId: owner.acquisitionId,
      ports,
      gracefulTimeoutMs: 0,
      forcedTimeoutMs: 5_000,
    });

    assert.equal(cleanupResult, "cleaned");
    assert.notEqual(wrapperFixture, null, "persistent service did not use a separately tracked wrapper");
    assert.equal(targetFixture, null, "service target started before descriptor publication succeeded");
    assertNoRunnerOwnershipPaths();
  } finally {
    if (wrapperFixture !== null) await stopPid(wrapperFixture.pid);
    if (targetFixture !== null) await stopPid(targetFixture.pid);
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("a pre-existing same-token run remains untouched", async (context) => {
  if (existsSync(E2E_PERSIST_PATH)) {
    context.skip("the fixed E2E persistence path already belongs to another run");
    return;
  }
  const token = runToken();
  const acquisitionId = runToken();
  const ports = await unusedPorts();
  const sentinelPath = path.resolve(E2E_PERSIST_PATH, "same-token-owner.txt");
  const owned = spawn(process.execPath, [
    `--title=${processIdentityMarker(token, "harness")}`,
    "-e",
    "setInterval(() => {}, 1000)",
  ], { stdio: "ignore", windowsHide: true });
  const { runOwnedE2E } = await loadRunner();

  try {
    await waitUntil(() => owned.pid && isProcessAlive(owned.pid));
    acquireRunPersistence(E2E_PERSIST_PATH, token, ports, acquisitionId);
    writeRunManifest(E2E_PERSIST_PATH, token, {
      harness: { pid: owned.pid, role: "harness", tree: false },
      children: [],
    }, ports, acquisitionId);
    writeFileSync(sentinelPath, "prior same-token acquisition\n");

    await assert.rejects(
      runOwnedE2E({
        env: {
          ...process.env,
          PLEROMA_E2E_RUN_TOKEN: token,
          PLEROMA_E2E_WEB_PORT: String(ports.web),
          PLEROMA_E2E_WORKER_PORT: String(ports.worker),
          npm_execpath: npmExecPath(),
        },
        playwrightArgs: ["--list"],
      }),
      /persistence already exists/i,
    );

    assert.equal(isProcessAlive(owned.pid), true, "prior same-token owner was signaled");
    assert.equal(readFileSync(sentinelPath, "utf8"), "prior same-token acquisition\n");
    assert.notEqual(
      readOwnedManifest(E2E_PERSIST_PATH, token, ports, acquisitionId),
      null,
    );
    assertNoRunnerOwnershipPaths();
  } finally {
    if (belongsToAcquisition(E2E_PERSIST_PATH, token, ports)) {
      await teardownOwnedRun({
        persistencePath: E2E_PERSIST_PATH,
        runToken: token,
        acquisitionId,
        ports,
        gracefulTimeoutMs: 0,
        forcedTimeoutMs: 5_000,
      });
    }
    if (owned.pid) await stopPid(owned.pid);
  }
});

test("direct and production Playwright config paths never own foreign local persistence", (context) => {
  if (existsSync(E2E_PERSIST_PATH)) {
    context.skip("the fixed E2E persistence path already belongs to another run");
    return;
  }
  const sentinelPath = path.resolve(E2E_PERSIST_PATH, "foreign-config.txt");
  mkdirSync(E2E_PERSIST_PATH);
  writeFileSync(sentinelPath, "foreign config persistence\n");
  const directEnv = { ...process.env };
  delete directEnv.PLEROMA_E2E_RUN_TOKEN;
  delete directEnv.PLEROMA_E2E_WEB_PORT;
  delete directEnv.PLEROMA_E2E_WORKER_PORT;
  delete directEnv.PLEROMA_PRODUCTION_GATE;
  delete directEnv.PLEROMA_PRODUCTION_URL;
  delete directEnv.PLEROMA_PRODUCTION_API_URL;

  try {
    const direct = spawnSync(process.execPath, [PLAYWRIGHT_CLI, "test", "--list"], {
      cwd: WEB_ROOT,
      env: directEnv,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    assert.notEqual(direct.status, 0);
    assert.match(`${direct.stdout}\n${direct.stderr}`, /ownership token/i);
    assert.equal(readFileSync(sentinelPath, "utf8"), "foreign config persistence\n");

    const production = spawnSync(process.execPath, [PLAYWRIGHT_CLI, "test", "--list"], {
      cwd: WEB_ROOT,
      env: {
        ...directEnv,
        PLEROMA_PRODUCTION_GATE: "1",
        PLEROMA_PRODUCTION_URL: "https://example.invalid",
        PLEROMA_PRODUCTION_API_URL: "https://example.invalid",
      },
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    assert.equal(production.status, 0, `${production.stdout}\n${production.stderr}`);
    assert.equal(readFileSync(sentinelPath, "utf8"), "foreign config persistence\n");
  } finally {
    rmSync(E2E_PERSIST_PATH, { recursive: true, force: true });
  }
});

test("an already-aborted runner spawns no Playwright process", async () => {
  const token = runToken();
  const fixtureRoot = path.resolve(E2E_TMP_ROOT, `runner-preaborted-${token}`);
  const readyPath = path.resolve(fixtureRoot, "playwright-root.json");
  const controller = new AbortController();
  controller.abort();
  mkdirSync(fixtureRoot, { recursive: true });
  const { runOwnedE2E } = await loadRunner();

  try {
    await assert.rejects(
      runOwnedE2E({
        env: {
          ...process.env,
          NODE_OPTIONS: preloadNodeOptions(),
          PLEROMA_E2E_PRELOAD_MODE: "record-playwright-root",
          PLEROMA_E2E_PRELOAD_READY: readyPath,
          PLEROMA_PRODUCTION_GATE: "1",
          PLEROMA_PRODUCTION_URL: "https://example.invalid",
          PLEROMA_PRODUCTION_API_URL: "https://example.invalid",
        },
        playwrightArgs: ["--list"],
        signal: controller.signal,
      }),
      { name: "AbortError" },
    );
    await delay(250);
    assert.equal(existsSync(readyPath), false, "an aborted run still spawned Playwright");
    assertNoRunnerOwnershipPaths();
  } finally {
    if (existsSync(readyPath)) await stopPid(readPidFixture(readyPath).pid);
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("cancellation before owner publication retires and awaits the blocked stack", async (context) => {
  if (existsSync(E2E_PERSIST_PATH)) {
    context.skip("the fixed E2E persistence path already belongs to another run");
    return;
  }
  const token = runToken();
  const fixtureRoot = path.resolve(E2E_TMP_ROOT, `runner-preowner-${token}`);
  const readyPath = path.resolve(fixtureRoot, "stack.json");
  const releasePath = path.resolve(fixtureRoot, "release");
  const controller = new AbortController();
  const ports = await unusedPorts();
  let stackPid = null;
  let launchGatePid = null;
  let running;
  mkdirSync(fixtureRoot, { recursive: true });
  const { runOwnedE2E } = await loadRunner();

  try {
    running = runOwnedE2E({
      env: {
        ...process.env,
        NODE_OPTIONS: preloadNodeOptions(),
        PLEROMA_E2E_PRELOAD_MODE: "block-stack-before-owner",
        PLEROMA_E2E_PRELOAD_READY: readyPath,
        PLEROMA_E2E_PRELOAD_RELEASE: releasePath,
        PLEROMA_E2E_RUN_TOKEN: token,
        PLEROMA_E2E_WEB_PORT: String(ports.web),
        PLEROMA_E2E_WORKER_PORT: String(ports.worker),
        npm_execpath: npmExecPath(),
      },
      playwrightArgs: ["--list"],
      signal: controller.signal,
    });
    await waitUntil(() => existsSync(readyPath));
    stackPid = readPidFixture(readyPath).pid;
    const launchPath = path.resolve(E2E_TMP_ROOT, `e2e-runner-stack-${token}`);
    const launchManifest = readManifestFor(launchPath, token, ports);
    assert.notEqual(launchManifest, null, "runner launch proof was not published");
    launchGatePid = launchManifest.harness.pid;
    assert.notEqual(
      launchGatePid,
      stackPid,
      "stack target executed before a separate launch gate was published",
    );
    assert.equal(isProcessAlive(launchGatePid), true);
    assert.equal(existsSync(E2E_PERSIST_PATH), false);
    controller.abort();

    const outcome = await settleWithin(
      running.then(
        (code) => ({ type: "resolved", code }),
        (error) => ({ type: "rejected", error }),
      ),
      10_000,
    );
    assert.equal(outcome.type, "rejected", "runner waited forever for a pre-owner stack");
    assert.equal(outcome.error?.name, "AbortError");
    assert.equal(isProcessAlive(stackPid), false);
    assert.equal(isProcessAlive(launchGatePid), false);
    assert.equal(existsSync(E2E_PERSIST_PATH), false);
    assertNoRunnerOwnershipPaths();
    await assertPortsReleased(ports);
  } finally {
    controller.abort();
    if (stackPid !== null) await stopPid(stackPid);
    if (running) await running.catch(() => {});
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("fixed-persistence refusal still retires and awaits the independent launch tree", async (context) => {
  if (existsSync(E2E_PERSIST_PATH)) {
    context.skip("the fixed E2E persistence path already belongs to another run");
    return;
  }
  const token = runToken();
  const fixtureRoot = path.resolve(E2E_TMP_ROOT, `runner-fixed-refusal-${token}`);
  const readyPath = path.resolve(fixtureRoot, "stack.json");
  const releasePath = path.resolve(fixtureRoot, "release");
  const launchPath = path.resolve(E2E_TMP_ROOT, `e2e-runner-stack-${token}`);
  const sentinelPath = path.resolve(E2E_PERSIST_PATH, "foreign.txt");
  const controller = new AbortController();
  const ports = await unusedPorts();
  let stackPid = null;
  let launchGatePid = null;
  let running;
  mkdirSync(fixtureRoot, { recursive: true });
  const { runOwnedE2E } = await loadRunner();

  try {
    running = runOwnedE2E({
      env: {
        ...process.env,
        NODE_OPTIONS: preloadNodeOptions(),
        PLEROMA_E2E_PRELOAD_MODE: "block-stack-before-owner",
        PLEROMA_E2E_PRELOAD_READY: readyPath,
        PLEROMA_E2E_PRELOAD_RELEASE: releasePath,
        PLEROMA_E2E_RUN_TOKEN: token,
        PLEROMA_E2E_WEB_PORT: String(ports.web),
        PLEROMA_E2E_WORKER_PORT: String(ports.worker),
        npm_execpath: npmExecPath(),
      },
      playwrightArgs: ["--list"],
      signal: controller.signal,
    });
    await waitUntil(() => existsSync(readyPath));
    stackPid = readPidFixture(readyPath).pid;
    const launchManifest = readManifestFor(launchPath, token, ports);
    assert.notEqual(launchManifest, null);
    launchGatePid = launchManifest.harness.pid;
    mkdirSync(E2E_PERSIST_PATH);
    writeFileSync(sentinelPath, "foreign fixed persistence\n");
    controller.abort();

    await assert.rejects(running, /not-owner/);
    assert.equal(existsSync(sentinelPath), true, "foreign fixed persistence was touched");
    assert.equal(isProcessAlive(stackPid), false, "blocked stack survived cleanup refusal");
    assert.equal(isProcessAlive(launchGatePid), false, "launch gate survived cleanup refusal");
    assert.equal(existsSync(launchPath), false, "independent launch proof survived settlement");
    await assertPortsReleased(ports);
  } finally {
    controller.abort();
    if (stackPid !== null) await stopPid(stackPid);
    if (launchGatePid !== null) await stopPid(launchGatePid);
    if (running) await running.catch(() => {});
    if (belongsToAcquisition(launchPath, token, ports)) {
      await teardownOwnedRun({
        persistencePath: launchPath,
        runToken: token,
        acquisitionId: acquisitionIdFor(launchPath),
        ports,
        gracefulTimeoutMs: 0,
        forcedTimeoutMs: 5_000,
      });
    }
    rmSync(E2E_PERSIST_PATH, { recursive: true, force: true });
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("cancellation retires a blocked startup command and its descendant", async (context) => {
  if (existsSync(E2E_PERSIST_PATH)) {
    context.skip("the fixed E2E persistence path already belongs to another run");
    return;
  }
  const token = runToken();
  const fixtureRoot = path.resolve(E2E_TMP_ROOT, `runner-startup-${token}`);
  const readyPath = path.resolve(fixtureRoot, "startup.json");
  const controller = new AbortController();
  const ports = await unusedPorts();
  let fixture = null;
  let startupPid = null;
  mkdirSync(fixtureRoot, { recursive: true });
  const { runOwnedE2E } = await loadRunner();

  try {
    const running = runOwnedE2E({
      env: {
        ...process.env,
        PLEROMA_E2E_RUN_TOKEN: token,
        PLEROMA_E2E_WEB_PORT: String(ports.web),
        PLEROMA_E2E_WORKER_PORT: String(ports.worker),
        PLEROMA_E2E_STARTUP_READY: readyPath,
        npm_execpath: BLOCKED_STARTUP,
      },
      playwrightArgs: ["--list"],
      signal: controller.signal,
    });
    await waitUntil(() => existsSync(readyPath));
    fixture = readPidFixture(readyPath);
    const manifest = readManifestFor(E2E_PERSIST_PATH, token, ports);
    const startup = manifest?.children.find(({ role }) => role === "startup");
    assert.notEqual(startup, undefined, "startup command was not published before execution");
    startupPid = startup.pid;
    assert.equal(isProcessAlive(fixture.childPid), true);
    assert.equal(isProcessAlive(fixture.descendantPid), true);
    controller.abort();
    await assert.rejects(running, { name: "AbortError" });

    assert.equal(isProcessAlive(fixture.childPid), false, "startup command survived cancellation");
    assert.equal(
      isProcessAlive(fixture.descendantPid),
      false,
      "startup command descendant survived cancellation",
    );
    assert.equal(isProcessAlive(startupPid), false, "tracked startup wrapper survived cancellation");
    assert.equal(existsSync(E2E_PERSIST_PATH), false);
    assertNoRunnerOwnershipPaths();
    await assertPortsReleased(ports);
  } finally {
    controller.abort();
    if (fixture !== null) {
      await stopPid(fixture.descendantPid);
      await stopPid(fixture.childPid);
    }
    if (belongsToAcquisition(E2E_PERSIST_PATH, token, ports)) {
      await teardownOwnedRun({
        persistencePath: E2E_PERSIST_PATH,
        runToken: token,
        acquisitionId: acquisitionIdFor(E2E_PERSIST_PATH),
        ports,
        gracefulTimeoutMs: 0,
        forcedTimeoutMs: 5_000,
      });
    }
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("an exited startup target keeps its proven wrapper until final teardown", async (context) => {
  if (existsSync(E2E_PERSIST_PATH)) {
    context.skip("the fixed E2E persistence path already belongs to another run");
    return;
  }
  const token = runToken();
  const fixtureRoot = path.resolve(E2E_TMP_ROOT, `runner-exited-startup-${token}`);
  const readyPath = path.resolve(fixtureRoot, "startup.json");
  const controller = new AbortController();
  const ports = await unusedPorts();
  let fixture = null;
  mkdirSync(fixtureRoot, { recursive: true });
  const { runOwnedE2E } = await loadRunner();
  const running = runOwnedE2E({
    env: {
      ...process.env,
      PLEROMA_E2E_RUN_TOKEN: token,
      PLEROMA_E2E_WEB_PORT: String(ports.web),
      PLEROMA_E2E_WORKER_PORT: String(ports.worker),
      PLEROMA_E2E_STARTUP_READY: readyPath,
      npm_execpath: EXITED_STARTUP,
    },
    playwrightArgs: ["--list"],
    signal: controller.signal,
  });

  try {
    await waitUntil(() => existsSync(readyPath));
    fixture = readPidFixture(readyPath);
    await waitUntil(() => !isProcessAlive(fixture.targetPid));
    await delay(250);
    const manifest = readManifestFor(E2E_PERSIST_PATH, token, ports);
    assert.equal(
      manifest?.children.some(({ pid, role }) => pid === fixture.wrapperPid && role === "startup"),
      true,
      "startup wrapper descriptor was removed after target exit",
    );
    assert.equal(isProcessAlive(fixture.wrapperPid), true, "startup wrapper exited before final teardown");
    assert.equal(isProcessAlive(fixture.descendantPid), true);

    controller.abort();
    await assert.rejects(running, { name: "AbortError" });
    assert.equal(isProcessAlive(fixture.wrapperPid), false);
    assert.equal(isProcessAlive(fixture.descendantPid), false);
    assert.equal(existsSync(E2E_PERSIST_PATH), false);
    assertNoRunnerOwnershipPaths();
    await assertPortsReleased(ports);
  } finally {
    controller.abort();
    await running.catch(() => {});
    if (fixture !== null) {
      await stopPid(fixture.descendantPid);
      await stopPid(fixture.wrapperPid);
    }
    if (belongsToAcquisition(E2E_PERSIST_PATH, token, ports)) {
      await teardownOwnedRun({
        persistencePath: E2E_PERSIST_PATH,
        runToken: token,
        acquisitionId: acquisitionIdFor(E2E_PERSIST_PATH),
        ports,
        gracefulTimeoutMs: 0,
        forcedTimeoutMs: 5_000,
      });
    }
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("Playwright cancellation settles only after its real process tree exits", async () => {
  const token = runToken();
  const fixtureRoot = path.resolve(E2E_TMP_ROOT, `runner-playwright-${token}`);
  const rootReadyPath = path.resolve(fixtureRoot, "playwright-root.json");
  const workerReadyPath = path.resolve(fixtureRoot, "playwright-worker.json");
  const controller = new AbortController();
  let fixture = null;
  let rootPid = null;
  mkdirSync(fixtureRoot, { recursive: true });
  const { runOwnedE2E } = await loadRunner();

  try {
    const running = runOwnedE2E({
      env: {
        ...process.env,
        NODE_OPTIONS: preloadNodeOptions(),
        PLEROMA_E2E_PRELOAD_MODE: "record-playwright-root",
        PLEROMA_E2E_PRELOAD_READY: rootReadyPath,
        PLEROMA_E2E_PLAYWRIGHT_READY: workerReadyPath,
        PLEROMA_PRODUCTION_GATE: "1",
        PLEROMA_PRODUCTION_URL: "https://example.invalid",
        PLEROMA_PRODUCTION_API_URL: "https://example.invalid",
      },
      playwrightArgs: ["--config", BLOCKED_PLAYWRIGHT_CONFIG],
      signal: controller.signal,
    });
    await waitUntil(() => existsSync(rootReadyPath) && existsSync(workerReadyPath));
    rootPid = readPidFixture(rootReadyPath).pid;
    fixture = readPidFixture(workerReadyPath);
    controller.abort();
    await assert.rejects(running, { name: "AbortError" });

    assert.equal(isProcessAlive(rootPid), false, "Playwright root survived runner settlement");
    assert.equal(isProcessAlive(fixture.workerPid), false, "Playwright worker survived runner settlement");
    assert.equal(
      isProcessAlive(fixture.descendantPid),
      false,
      "Playwright descendant survived runner settlement",
    );
    assertNoRunnerOwnershipPaths();
  } finally {
    controller.abort();
    if (fixture !== null) {
      await stopPid(fixture.descendantPid);
      await stopPid(fixture.workerPid);
    }
    if (rootPid !== null) await stopPid(rootPid);
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("Playwright cancellation contains a grandchild behind an exited intermediate", async (context) => {
  if (process.platform !== "win32") {
    context.skip("Windows Job Object containment covers exited-intermediate lineage");
    return;
  }
  const token = runToken();
  const fixtureRoot = path.resolve(E2E_TMP_ROOT, `runner-orphan-${token}`);
  const readyPath = path.resolve(fixtureRoot, "orphan.json");
  const controller = new AbortController();
  let fixture = null;
  mkdirSync(fixtureRoot, { recursive: true });
  const { runOwnedE2E } = await loadRunner();
  const running = runOwnedE2E({
    env: {
      ...process.env,
      PLEROMA_E2E_ORPHAN_READY: readyPath,
      PLEROMA_PRODUCTION_GATE: "1",
      PLEROMA_PRODUCTION_URL: "https://example.invalid",
      PLEROMA_PRODUCTION_API_URL: "https://example.invalid",
    },
    playwrightArgs: ["--config", ORPHAN_PLAYWRIGHT_CONFIG],
    signal: controller.signal,
  });

  try {
    await waitUntil(() => existsSync(readyPath));
    fixture = readPidFixture(readyPath);
    await waitUntil(() => !isProcessAlive(fixture.intermediatePid));
    assert.equal(isProcessAlive(fixture.grandchildPid), true);
    await delay(500);
    controller.abort();
    await assert.rejects(running, { name: "AbortError" });

    assert.equal(
      isProcessAlive(fixture.grandchildPid),
      false,
      "grandchild behind an exited intermediate survived runner settlement",
    );
    assertNoRunnerOwnershipPaths();
  } finally {
    controller.abort();
    await running.catch(() => {});
    if (fixture !== null) await stopPid(fixture.grandchildPid);
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("runner startup failure preserves a foreign port owner and foreign persistence", async (context) => {
  const listener = net.createServer();
  const token = runToken();
  const sentinelPath = path.resolve(E2E_PERSIST_PATH, `foreign-${token}.txt`);
  let ownsFixture = false;

  try {
    mkdirSync(E2E_TMP_ROOT, { recursive: true });
    try {
      mkdirSync(E2E_PERSIST_PATH);
      ownsFixture = true;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      context.skip("the fixed E2E persistence path already belongs to another run");
      return;
    }
    writeFileSync(sentinelPath, "foreign persistence\n");
    await listen(listener, 0, "127.0.0.1");
    const address = listener.address();
    assert.notEqual(address, null);
    assert.equal(typeof address, "object");
    const webPort = await unusedPort();
    const { runOwnedE2E } = await loadRunner();

    await assert.rejects(
      runOwnedE2E({
        env: {
          ...process.env,
          npm_execpath: npmExecPath(),
          PLEROMA_E2E_RUN_TOKEN: token,
          PLEROMA_E2E_WEB_PORT: String(webPort),
          PLEROMA_E2E_WORKER_PORT: String(address.port),
        },
        playwrightArgs: ["--list"],
      }),
      /stack exited|Refusing to start/i,
    );

    assert.equal(listener.listening, true);
    assert.equal(existsSync(sentinelPath), true);
    assert.equal(readFileSync(sentinelPath, "utf8"), "foreign persistence\n");
  } finally {
    if (listener.listening) await close(listener);
    if (ownsFixture) rmSync(E2E_PERSIST_PATH, { recursive: true, force: true });
  }
});

test("runner cancellation retires its real stack and owned persistence", async (context) => {
  if (existsSync(E2E_PERSIST_PATH)) {
    context.skip("the fixed E2E persistence path already belongs to another run");
    return;
  }
  const token = runToken();
  const ports = await unusedPorts();
  const controller = new AbortController();
  let harnessPid = null;
  const { runOwnedE2E } = await loadRunner();

  try {
    const running = runOwnedE2E({
      env: {
        ...process.env,
        npm_execpath: npmExecPath(),
        PLEROMA_E2E_RUN_TOKEN: token,
        PLEROMA_E2E_WEB_PORT: String(ports.web),
        PLEROMA_E2E_WORKER_PORT: String(ports.worker),
      },
      playwrightArgs: ["--list"],
      signal: controller.signal,
    });

    await waitUntil(() => (
      belongsToAcquisition(E2E_PERSIST_PATH, token, ports)
      && readManifestFor(E2E_PERSIST_PATH, token, ports) !== null
    ));
    harnessPid = readManifestFor(E2E_PERSIST_PATH, token, ports).harness.pid;
    controller.abort();
    await assert.rejects(running, { name: "AbortError" });

    assert.equal(existsSync(E2E_PERSIST_PATH), false);
    assert.equal(isProcessAlive(harnessPid), false);
    assertNoRunnerOwnershipPaths();
    await assertPortsReleased(ports);
  } finally {
    controller.abort();
    if (belongsToAcquisition(E2E_PERSIST_PATH, token, ports)) {
      await teardownOwnedRun({
        persistencePath: E2E_PERSIST_PATH,
        runToken: token,
        acquisitionId: acquisitionIdFor(E2E_PERSIST_PATH),
        ports,
        gracefulTimeoutMs: 0,
        forcedTimeoutMs: 5_000,
      });
    }
    if (harnessPid !== null && isProcessAlive(harnessPid)) {
      process.kill(harnessPid, "SIGTERM");
      await waitUntil(() => !isProcessAlive(harnessPid));
    }
  }
});
