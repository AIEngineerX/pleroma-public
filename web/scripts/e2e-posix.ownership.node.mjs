import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as ownership from "./e2e-run-ownership.mjs";
import {
  DEFAULT_E2E_PORTS,
  E2E_TMP_ROOT,
  acquireRunPersistence,
  isProcessAlive,
  ownershipPaths,
  processBelongsToRun,
  processBelongsToRunSync,
  processIdentityMarker,
  teardownOwnedRun,
  writeRunManifest,
} from "./e2e-run-ownership.mjs";

const SCRIPT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const MANAGED_COMMAND = path.resolve(SCRIPT_ROOT, "e2e-managed-command.mjs");
const EXITED_STARTUP = path.resolve(SCRIPT_ROOT, "fixtures/e2e-exited-startup.mjs");

function runToken() {
  return randomBytes(32).toString("hex");
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
  assert.fail("timed out waiting for POSIX process state");
}

async function stopPid(pid) {
  if (!isProcessAlive(pid)) return;
  process.kill(pid, "SIGTERM");
  await waitUntil(() => !isProcessAlive(pid));
}

async function stopGroup(groupId) {
  try {
    process.kill(-groupId, "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
  await waitUntil(() => {
    try {
      process.kill(-groupId, 0);
      return false;
    } catch (error) {
      return error?.code === "ESRCH";
    }
  });
}

test("POSIX numeric group identity is unavailable after its proven leader exits", () => {
  assert.equal(
    ownership.posixProcessGroupAuthorityState?.({
      groupAlive: true,
      leaderAlive: false,
      leaderOwned: false,
    }),
    "unavailable",
    "a leaderless numeric PGID can be reused and is not durable kill authority",
  );
});

test("POSIX recognizes Node's exact bare process title as owned", async (context) => {
  if (process.platform === "win32") {
    context.skip("run through the WSL bridge on Windows");
    return;
  }
  const token = runToken();
  const role = "worker";
  const child = spawn(
    process.execPath,
    [`--title=${processIdentityMarker(token, role)}`, "-e", "setInterval(() => {}, 1000)"],
    { stdio: "ignore" },
  );
  try {
    await waitUntil(() => child.pid && isProcessAlive(child.pid));
    const marker = processIdentityMarker(token, role);
    const procCommandLine = `/proc/${child.pid}/cmdline`;
    if (existsSync(procCommandLine)) {
      await waitUntil(() => {
        const argv = readFileSync(procCommandLine, "utf8").split("\0").filter(Boolean);
        return argv.length === 1 && argv[0] === marker;
      });
    } else {
      await waitUntil(() => processBelongsToRunSync(child.pid, token, role));
    }
    assert.equal(await processBelongsToRun(child.pid, token, role), true);
  } finally {
    await stopPid(child.pid);
  }
});

test("POSIX managed wrapper retires its lingering group when parent IPC disconnects", async (context) => {
  if (process.platform === "win32") {
    context.skip("run through the WSL bridge on Windows");
    return;
  }
  const token = runToken();
  const fixtureRoot = path.resolve(E2E_TMP_ROOT, `e2e-posix-wrapper-${token}`);
  const readyPath = path.resolve(fixtureRoot, "target.json");
  mkdirSync(fixtureRoot, { recursive: true });
  const wrapper = spawn(process.execPath, [
    `--title=${processIdentityMarker(token, "startup")}`,
    MANAGED_COMMAND,
    EXITED_STARTUP,
  ], {
    detached: true,
    env: { ...process.env, PLEROMA_E2E_STARTUP_READY: readyPath },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  let fixture = null;
  const targetExit = new Promise((resolve, reject) => {
    wrapper.on("message", (message) => {
      if (message?.type === "pleroma-e2e-target-exit") resolve(message);
    });
    wrapper.once("error", reject);
    wrapper.once("exit", (code, signal) => reject(new Error(
      `wrapper exited before target result (${signal ?? code ?? "unknown"})`,
    )));
  });
  try {
    await new Promise((resolve, reject) => {
      const onMessage = (message) => {
        if (message?.type !== "pleroma-e2e-command-ready") return;
        wrapper.removeListener("message", onMessage);
        resolve();
      };
      wrapper.on("message", onMessage);
      wrapper.send({ type: "pleroma-e2e-command-probe" }, (error) => {
        if (error) reject(error);
      });
    });
    wrapper.send({ type: "pleroma-e2e-start" });
    await waitUntil(() => existsSync(readyPath));
    fixture = JSON.parse(readFileSync(readyPath, "utf8"));
    await targetExit;
    await waitUntil(() => !isProcessAlive(fixture.targetPid));
    assert.equal(isProcessAlive(wrapper.pid), true);
    assert.equal(isProcessAlive(fixture.descendantPid), true);

    wrapper.disconnect();
    await waitUntil(() => !isProcessAlive(wrapper.pid));
    await delay(250);
    assert.equal(
      isProcessAlive(fixture.descendantPid),
      false,
      "lingering descendant survived its wrapper's parent IPC disconnect",
    );
  } finally {
    await stopGroup(wrapper.pid);
    if (fixture !== null) await stopPid(fixture.descendantPid);
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("POSIX teardown preserves a group after its proven leader exits", async (context) => {
  if (process.platform === "win32") {
    context.skip("run through the WSL bridge on Windows");
    return;
  }
  const token = runToken();
  const persistencePath = path.resolve(E2E_TMP_ROOT, `e2e-posix-${token}`);
  const { shutdownPath } = ownershipPaths(persistencePath);
  const childProgram = "setInterval(() => {}, 1000)";
  const rootProgram = [
    'const { spawn } = require("node:child_process");',
    'const { existsSync } = require("node:fs");',
    `const shutdownPath = ${JSON.stringify(shutdownPath)};`,
    `const child = spawn(process.execPath, ["-e", ${JSON.stringify(childProgram)}], { stdio: "ignore" });`,
    'process.stdout.write(`${child.pid}\\n`);',
    "const watcher = setInterval(() => {",
    "  if (!existsSync(shutdownPath)) return;",
    "  clearInterval(watcher);",
    "  process.exit(0);",
    "}, 1);",
  ].join("\n");
  const root = spawn(
    process.execPath,
    [`--title=${processIdentityMarker(token, "harness")}`, "-e", rootProgram],
    { detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  root.stdout.on("data", (chunk) => { output += chunk; });
  root.stderr.on("data", (chunk) => { output += chunk; });
  let childPid = null;
  try {
    await waitUntil(() => /^\d+\n/.test(output));
    childPid = Number.parseInt(output, 10);
    assert.equal(isProcessAlive(childPid), true);
    acquireRunPersistence(persistencePath, token, DEFAULT_E2E_PORTS, token);
    writeRunManifest(persistencePath, token, {
      harness: { pid: root.pid, role: "harness", tree: true },
      children: [],
    }, DEFAULT_E2E_PORTS, token);

    const result = await teardownOwnedRun({
      persistencePath,
      runToken: token,
      acquisitionId: token,
      ports: DEFAULT_E2E_PORTS,
      gracefulTimeoutMs: 100,
      forcedTimeoutMs: 2_000,
      deletionTimeoutMs: 1_000,
    });

    assert.equal(result, "identity-unavailable");
    assert.equal(existsSync(persistencePath), true);
    assert.equal(isProcessAlive(root.pid), false);
    assert.equal(
      isProcessAlive(childPid),
      true,
      "a leaderless group must remain outside kill authority",
    );
  } finally {
    await stopGroup(root.pid);
    if (childPid !== null) await stopPid(childPid);
    rmSync(persistencePath, { recursive: true, force: true });
  }
});
