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
import { launcherRunConfiguration } from "./e2e-stack.mjs";

const SCRIPT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_ROOT, "../..");
const STACK_SCRIPT = path.resolve(SCRIPT_ROOT, "e2e-stack.mjs");
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
