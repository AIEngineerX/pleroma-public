import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
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
  ownershipPaths,
  processBelongsToRun,
  processIdentityMarker,
  readE2EPorts,
  teardownOwnedRun,
} from "./e2e-run-ownership.mjs";
import { launcherRunConfiguration, writeE2EWranglerConfig } from "./e2e-stack.mjs";

const SCRIPT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_ROOT, "../..");
const STACK_SCRIPT = path.resolve(SCRIPT_ROOT, "e2e-stack.mjs");
const WORKER_ROOT = path.resolve(REPOSITORY_ROOT, "worker");
const WRANGLER_CLI = path.resolve(WORKER_ROOT, "node_modules/wrangler/bin/wrangler.js");
const FIXED_SENTINEL_NAME = "must-survive-port-collision.txt";
const TEST_PORTS = { web: 4173, worker: 8787 };

function runToken() {
  return randomBytes(32).toString("hex");
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitUntil(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(25);
  }
  assert.fail("timed out waiting for process state");
}

async function spawnMarkedProcess(token, role, lifetimeMs = null) {
  const program = lifetimeMs === null
    ? "setInterval(() => {}, 1000)"
    : `setTimeout(() => process.exit(0), ${lifetimeMs})`;
  const child = spawn(
    process.execPath,
    [`--title=${processIdentityMarker(token, role)}`, "-e", program],
    { stdio: "ignore", windowsHide: true },
  );
  await waitUntil(() => child.pid && isAlive(child.pid));
  assert.equal(await processBelongsToRun(child.pid, token, role), true);
  return child;
}

async function stopChild(child) {
  if (!child.pid || !isAlive(child.pid)) return;
  child.kill("SIGTERM");
  await waitUntil(() => !isAlive(child.pid));
}

function testPersistencePath() {
  return path.resolve(E2E_TMP_ROOT, `e2e-ownership-${runToken()}`);
}

function fixturePaths(persistencePath) {
  const { ownerPath, manifestPath, shutdownPath } = ownershipPaths(persistencePath);
  return {
    ownerPath,
    manifestPath,
    shutdownPath,
    sentinelPath: path.resolve(persistencePath, "must-survive.txt"),
  };
}

function writeOwnership(persistencePath, token, manifest, ports = TEST_PORTS) {
  mkdirSync(E2E_TMP_ROOT, { recursive: true });
  mkdirSync(persistencePath);
  const { ownerPath, manifestPath } = fixturePaths(persistencePath);
  writeFileSync(ownerPath, JSON.stringify({ runToken: token, ports }));
  writeFileSync(manifestPath, JSON.stringify({ runToken: token, ports, ...manifest }));
}

function removeTestPersistence(persistencePath) {
  assert.notEqual(path.resolve(persistencePath), E2E_PERSIST_PATH);
  rmSync(persistencePath, { recursive: true, force: true });
}

async function removeTestPersistenceEventually(persistencePath) {
  assert.notEqual(path.resolve(persistencePath), E2E_PERSIST_PATH);
  const deadline = Date.now() + 10_000;
  while (true) {
    try {
      rmSync(persistencePath, { recursive: true, force: true });
      return;
    } catch (error) {
      if (
        !["EPERM", "EBUSY", "ENOTEMPTY"].includes(error?.code)
        || Date.now() >= deadline
      ) throw error;
      await delay(100);
    }
  }
}

function acquireFixedPersistenceFixture(contents) {
  mkdirSync(E2E_TMP_ROOT, { recursive: true });
  try {
    mkdirSync(E2E_PERSIST_PATH);
  } catch (error) {
    if (error?.code === "EEXIST") return null;
    throw error;
  }
  const sentinelPath = path.resolve(E2E_PERSIST_PATH, FIXED_SENTINEL_NAME);
  writeFileSync(sentinelPath, contents);
  return sentinelPath;
}

function releaseFixedPersistenceFixture(sentinelPath, contents) {
  if (sentinelPath === null || !existsSync(E2E_PERSIST_PATH)) return;
  const entries = readdirSync(E2E_PERSIST_PATH);
  assert.deepEqual(entries, [FIXED_SENTINEL_NAME]);
  assert.equal(readFileSync(sentinelPath, "utf8"), contents);
  rmSync(E2E_PERSIST_PATH, { recursive: true });
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

function runStack(token, ports = TEST_PORTS) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      STACK_SCRIPT,
      `--pleroma-e2e-owner=${token}`,
      "--pleroma-e2e-role=harness",
      `--pleroma-e2e-web-port=${ports.web}`,
      `--pleroma-e2e-worker-port=${ports.worker}`,
    ], {
      cwd: path.resolve(REPOSITORY_ROOT, "web"),
      env: {
        ...process.env,
        PLEROMA_E2E_RUN_TOKEN: token,
        PLEROMA_E2E_WEB_PORT: String(ports.web),
        PLEROMA_E2E_WORKER_PORT: String(ports.worker),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal, output }));
  });
}

async function unusedPort() {
  const listener = net.createServer();
  await listen(listener, 0, "127.0.0.1");
  const address = listener.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  const port = address.port;
  await close(listener);
  return port;
}

function aliasProbeSource(version) {
  return [
    'import { ulid } from "ulid";',
    "export default {",
    `  fetch() { return new Response("${version}:" + ulid()); },`,
    "};",
    "",
  ].join("\n");
}

function spawnAliasProbe(entryPath, persistencePath, configPath, port) {
  const child = spawn(process.execPath, [
    WRANGLER_CLI,
    "dev",
    entryPath,
    "--local",
    "--config", configPath,
    "--port", String(port),
    "--persist-to", persistencePath,
  ], {
    cwd: WORKER_ROOT,
    env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  return { child, output: () => output };
}

function waitForChildExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", () => resolve());
  });
}

function spawnExclusiveFileLock(filePath, holdMs) {
  const escapedPath = filePath.replaceAll("'", "''");
  const script = [
    `$stream = [System.IO.File]::Open('${escapedPath}',`,
    "[System.IO.FileMode]::Open,",
    "[System.IO.FileAccess]::ReadWrite,",
    "[System.IO.FileShare]::None);",
    "[Console]::Out.Write('locked');",
    `Start-Sleep -Milliseconds ${holdMs};`,
    "$stream.Dispose()",
  ].join(" ");
  const child = spawn("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script,
  ], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

  return new Promise((resolve, reject) => {
    let output = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`timed out acquiring exclusive test lock: ${output}`));
    }, 5_000);
    const append = (chunk) => {
      output += chunk;
      if (settled || !output.includes("locked")) return;
      settled = true;
      clearTimeout(timeout);
      resolve(child);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`exclusive test lock exited ${String(code)}: ${output}`));
    });
  });
}

async function firstHttpResponse(url, output, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      return { status: response.status, body: await response.text() };
    } catch (error) {
      lastError = error;
      await delay(100);
    }
  }
  assert.fail(`Wrangler alias probe did not answer: ${String(lastError)}\n${output()}`);
}

async function waitForProbeVersion(url, version, output, timeoutMs = 15_000) {
  const expected = new RegExp(`^${version}:[0-9A-HJKMNP-TV-Z]{26}$`);
  const deadline = Date.now() + timeoutMs;
  let lastResponse = null;
  while (Date.now() < deadline) {
    lastResponse = await firstHttpResponse(url, output, 2_000);
    if (lastResponse.status === 200 && expected.test(lastResponse.body)) return;
    await delay(100);
  }
  assert.fail(
    `Wrangler alias probe never reached ${version}; last response ${JSON.stringify(lastResponse)}\n${output()}`,
  );
}

test("the launcher requires one token and validated matching run-scoped ports", () => {
  const token = runToken();
  const argv = [
    "node",
    STACK_SCRIPT,
    `--pleroma-e2e-owner=${token}`,
    "--pleroma-e2e-role=harness",
    "--pleroma-e2e-web-port=4174",
    "--pleroma-e2e-worker-port=8788",
  ];
  const env = {
    PLEROMA_E2E_RUN_TOKEN: token,
    PLEROMA_E2E_WEB_PORT: "4174",
    PLEROMA_E2E_WORKER_PORT: "8788",
  };
  assert.deepEqual(launcherRunConfiguration(argv, env), {
    runToken: token,
    ports: { web: 4174, worker: 8788 },
  });
  assert.deepEqual(readE2EPorts({}), { web: 4173, worker: 8787 });
  assert.throws(() => readE2EPorts({ PLEROMA_E2E_WEB_PORT: "0" }), /web port/i);
  assert.throws(() => readE2EPorts({
    PLEROMA_E2E_WEB_PORT: "5000",
    PLEROMA_E2E_WORKER_PORT: "5000",
  }), /must differ/i);
  assert.throws(
    () => launcherRunConfiguration(["node", STACK_SCRIPT], {}),
    /ownership token/i,
  );
  assert.throws(
    () => launcherRunConfiguration(
      argv.map((value) => value === `--pleroma-e2e-owner=${token}`
        ? `--pleroma-e2e-owner=${runToken()}`
        : value),
      env,
    ),
    /does not match/i,
  );
  assert.throws(
    () => launcherRunConfiguration(
      argv.map((value) => value === "--pleroma-e2e-web-port=4174"
        ? "--pleroma-e2e-web-port=4175"
        : value),
      env,
    ),
    /port.*does not match/i,
  );
});

test("Wrangler keeps the test ULID alias before and after a source reload", async () => {
  const token = runToken();
  const fixtureRoot = path.resolve(E2E_TMP_ROOT, `e2e-alias-${token}`);
  const entryPath = path.resolve(fixtureRoot, "probe.mjs");
  const persistencePath = path.resolve(fixtureRoot, "state");
  const port = await unusedPort();
  mkdirSync(fixtureRoot, { recursive: true });
  writeFileSync(entryPath, aliasProbeSource("v1"));
  const configPath = writeE2EWranglerConfig(fixtureRoot);
  const authoritativeConfig = readFileSync(path.resolve(WORKER_ROOT, "wrangler.toml"), "utf8");
  const generatedConfig = readFileSync(configPath, "utf8");
  const expectedAlias = path.resolve(
    REPOSITORY_ROOT,
    "web/e2e/fixtures/worker-ulid.mjs",
  ).replaceAll("\\", "/");
  const aliasBlock = `\n[alias]\nulid = ${JSON.stringify(expectedAlias)}\n`;
  assert.equal(generatedConfig.endsWith(aliasBlock), true);
  const withoutAlias = generatedConfig.slice(0, -aliasBlock.length);
  assert.equal(
    withoutAlias.replace(
      /^main = ".*\/worker\/src\/index\.ts"$/m,
      'main = "src/index.ts"',
    ),
    authoritativeConfig,
  );
  const probe = spawnAliasProbe(entryPath, persistencePath, configPath, port);

  try {
    const first = await firstHttpResponse(`http://127.0.0.1:${port}/`, probe.output);
    assert.equal(first.status, 200, `${first.body}\n${probe.output()}`);
    assert.match(first.body, /^v1:[0-9A-HJKMNP-TV-Z]{26}$/);

    writeFileSync(entryPath, aliasProbeSource("v2"));
    await waitForProbeVersion(`http://127.0.0.1:${port}/`, "v2", probe.output);
  } finally {
    await stopChild(probe.child);
    await removeTestPersistenceEventually(fixtureRoot);
  }
});

test("owned teardown outlasts delayed Windows persistence-handle release", async (context) => {
  if (process.platform !== "win32") {
    context.skip("FileShare.None models the Windows Wrangler SQLite handle lag");
    return;
  }

  const ownerToken = runToken();
  const recorded = await spawnMarkedProcess(ownerToken, "harness");
  const recordedPid = recorded.pid;
  await stopChild(recorded);
  const persistencePath = testPersistencePath();
  writeOwnership(persistencePath, ownerToken, {
    harness: { pid: recordedPid, role: "harness", tree: false },
    children: [],
  });
  const lockedPath = path.resolve(persistencePath, "delayed-metadata.sqlite");
  writeFileSync(lockedPath, "owned sqlite stand-in\n");
  const lockHolder = await spawnExclusiveFileLock(lockedPath, 12_000);

  try {
    const result = await teardownOwnedRun({
      persistencePath,
      runToken: ownerToken,
      ports: TEST_PORTS,
      gracefulTimeoutMs: 0,
      forcedTimeoutMs: 0,
    });
    assert.equal(result, "cleaned");
    assert.equal(existsSync(persistencePath), false);
  } finally {
    await waitForChildExit(lockHolder);
    if (existsSync(persistencePath)) {
      const cleanup = await teardownOwnedRun({
        persistencePath,
        runToken: ownerToken,
        ports: TEST_PORTS,
        gracefulTimeoutMs: 0,
        forcedTimeoutMs: 0,
        deletionTimeoutMs: 5_000,
      });
      assert.equal(cleanup, "cleaned");
    }
    removeTestPersistence(persistencePath);
  }
});

test("an occupied port fails without deleting persistence this harness does not own", async (context) => {
  const listener = net.createServer();
  const token = runToken();
  const sentinelContents = `owned by another stack ${token}\n`;
  let sentinelPath = null;

  try {
    await listen(listener, 8787, "127.0.0.1");
    sentinelPath = acquireFixedPersistenceFixture(sentinelContents);
    if (sentinelPath === null) {
      context.skip("the fixed E2E persistence path already belongs to another run");
      return;
    }

    const result = await runStack(token);
    assert.notEqual(result.code, 0, `harness unexpectedly succeeded:\n${result.output}`);
    assert.equal(
      existsSync(sentinelPath),
      true,
      `harness deleted unowned persistence after a port collision:\n${result.output}`,
    );
  } finally {
    if (listener.listening) await close(listener);
    releaseFixedPersistenceFixture(sentinelPath, sentinelContents);
  }
});

test("teardown cannot write, signal, or delete a directory owned by another run", async () => {
  const ownerToken = runToken();
  const teardownToken = runToken();
  const foreign = await spawnMarkedProcess(ownerToken, "harness");
  const persistencePath = testPersistencePath();
  const { sentinelPath, shutdownPath } = fixturePaths(persistencePath);
  try {
    writeOwnership(persistencePath, ownerToken, {
      harness: { pid: foreign.pid, role: "harness", tree: false },
      children: [],
    });
    writeFileSync(sentinelPath, "foreign run\n");

    const result = await teardownOwnedRun({
      persistencePath,
      runToken: teardownToken,
      ports: TEST_PORTS,
      gracefulTimeoutMs: 25,
      forcedTimeoutMs: 25,
    });

    assert.equal(result, "not-owner");
    assert.equal(isAlive(foreign.pid), true);
    assert.equal(existsSync(sentinelPath), true);
    assert.equal(existsSync(shutdownPath), false);
  } finally {
    await stopChild(foreign);
    removeTestPersistence(persistencePath);
  }
});

test("teardown cannot kill a reused foreign PID or delete its evidence", async () => {
  const ownerToken = runToken();
  const foreignToken = runToken();
  const foreign = await spawnMarkedProcess(foreignToken, "harness");
  const persistencePath = testPersistencePath();
  const { sentinelPath, shutdownPath } = fixturePaths(persistencePath);
  try {
    writeOwnership(persistencePath, ownerToken, {
      harness: { pid: foreign.pid, role: "harness", tree: false },
      children: [],
    });
    writeFileSync(sentinelPath, "reused foreign pid\n");

    const result = await teardownOwnedRun({
      persistencePath,
      runToken: ownerToken,
      ports: TEST_PORTS,
      gracefulTimeoutMs: 25,
      forcedTimeoutMs: 25,
    });

    assert.equal(result, "foreign-process");
    assert.equal(isAlive(foreign.pid), true);
    assert.equal(existsSync(sentinelPath), true);
    assert.deepEqual(JSON.parse(readFileSync(shutdownPath, "utf8")), {
      runToken: ownerToken,
      ports: TEST_PORTS,
    });
  } finally {
    await stopChild(foreign);
    removeTestPersistence(persistencePath);
  }
});

test("teardown preserves evidence after a reused foreign PID exits during its wait", async () => {
  const ownerToken = runToken();
  const foreignToken = runToken();
  const foreign = await spawnMarkedProcess(foreignToken, "harness", 4_000);
  const persistencePath = testPersistencePath();
  const { sentinelPath } = fixturePaths(persistencePath);
  try {
    writeOwnership(persistencePath, ownerToken, {
      harness: { pid: foreign.pid, role: "harness", tree: false },
      children: [],
    });
    writeFileSync(sentinelPath, "foreign pid exited during teardown\n");

    const result = await teardownOwnedRun({
      persistencePath,
      runToken: ownerToken,
      ports: TEST_PORTS,
      gracefulTimeoutMs: 25,
      forcedTimeoutMs: 6_000,
    });

    assert.equal(isAlive(foreign.pid), false);
    assert.equal(result, "foreign-process");
    assert.equal(existsSync(sentinelPath), true);
  } finally {
    await stopChild(foreign);
    removeTestPersistence(persistencePath);
  }
});

test("the owning run terminates its verified process and removes its persistence", async () => {
  const ownerToken = runToken();
  const owned = await spawnMarkedProcess(ownerToken, "harness");
  const persistencePath = testPersistencePath();
  try {
    writeOwnership(persistencePath, ownerToken, {
      harness: { pid: owned.pid, role: "harness", tree: false },
      children: [],
    });

    const result = await teardownOwnedRun({
      persistencePath,
      runToken: ownerToken,
      ports: TEST_PORTS,
      gracefulTimeoutMs: 25,
      forcedTimeoutMs: 2_000,
    });

    assert.equal(result, "cleaned");
    assert.equal(isAlive(owned.pid), false);
    assert.equal(existsSync(persistencePath), false);
  } finally {
    await stopChild(owned);
    removeTestPersistence(persistencePath);
  }
});
