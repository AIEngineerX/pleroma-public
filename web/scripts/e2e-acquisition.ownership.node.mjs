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
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_E2E_PORTS,
  E2E_PERSIST_PATH,
  E2E_TMP_ROOT,
  ownershipPaths,
  teardownOwnedRun,
} from "./e2e-run-ownership.mjs";

const SCRIPT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const PROBE_SCRIPT = path.resolve(SCRIPT_ROOT, "e2e-acquire-probe.mjs");

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
    await delay(10);
  }
  assert.fail("timed out waiting for concurrent acquisition state");
}

function spawnProbe(token, acquisitionId, barrierRoot) {
  const readyPath = path.resolve(barrierRoot, `${acquisitionId}.ready`);
  const releasePath = path.resolve(barrierRoot, "release");
  const child = spawn(process.execPath, [
    PROBE_SCRIPT,
    E2E_PERSIST_PATH,
    token,
    acquisitionId,
    readyPath,
    releasePath,
    String(DEFAULT_E2E_PORTS.web),
    String(DEFAULT_E2E_PORTS.worker),
  ], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const result = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal, output }));
  });
  return { readyPath, result };
}

test("the fixed persistence directory has exactly one atomic owner", async (context) => {
  if (existsSync(E2E_PERSIST_PATH)) {
    context.skip("the fixed E2E persistence path already belongs to another run");
    return;
  }
  const barrierRoot = path.resolve(E2E_TMP_ROOT, `e2e-acquire-${runToken()}`);
  const tokens = [runToken(), runToken()];
  const acquisitionIds = [runToken(), runToken()];
  mkdirSync(barrierRoot, { recursive: true });
  const probes = tokens.map((token, index) => spawnProbe(token, acquisitionIds[index], barrierRoot));
  let winner = null;
  try {
    await waitUntil(() => probes.every((probe) => existsSync(probe.readyPath)));
    writeFileSync(path.resolve(barrierRoot, "release"), "go\n", { flag: "wx" });
    const childResults = await Promise.all(probes.map((probe) => probe.result));
    for (const result of childResults) {
      assert.equal(result.code, 0, result.output);
    }
    const outcomes = childResults.map((result) => JSON.parse(result.output.trim()));
    const winners = outcomes.filter((outcome) => outcome.status === "won");
    const losers = outcomes.filter((outcome) => outcome.status === "lost");

    assert.equal(winners.length, 1, JSON.stringify(outcomes));
    assert.equal(losers.length, 1, JSON.stringify(outcomes));
    [winner] = winners;
    assert.equal(winner.manifestWritten, true);
    assert.equal(losers[0].ownerRewriteRejected, true);
    assert.equal(losers[0].manifestWriteRejected, true);
    assert.equal(losers[0].teardownResult, "not-owner");

    const { ownerPath } = ownershipPaths(E2E_PERSIST_PATH);
    assert.equal(JSON.parse(readFileSync(ownerPath, "utf8")).runToken, winner.runToken);
    const claims = readdirSync(E2E_PERSIST_PATH).filter((name) => name.startsWith("claim-"));
    assert.deepEqual(claims, [`claim-${winner.acquisitionId}.txt`]);
  } finally {
    if (winner !== null && existsSync(E2E_PERSIST_PATH)) {
      await teardownOwnedRun({
        persistencePath: E2E_PERSIST_PATH,
        runToken: winner.runToken,
        acquisitionId: winner.acquisitionId,
        ports: DEFAULT_E2E_PORTS,
        gracefulTimeoutMs: 0,
        forcedTimeoutMs: 0,
      });
    }
    rmSync(E2E_PERSIST_PATH, { recursive: true, force: true });
    rmSync(barrierRoot, { recursive: true, force: true });
  }
});

test("same-token concurrent acquisition cannot claim or teardown the winner", async (context) => {
  if (existsSync(E2E_PERSIST_PATH)) {
    context.skip("the fixed E2E persistence path already belongs to another run");
    return;
  }
  const barrierRoot = path.resolve(E2E_TMP_ROOT, `e2e-same-token-${runToken()}`);
  const token = runToken();
  const acquisitionIds = [runToken(), runToken()];
  mkdirSync(barrierRoot, { recursive: true });
  const probes = acquisitionIds.map((acquisitionId) => (
    spawnProbe(token, acquisitionId, barrierRoot)
  ));
  let winner = null;
  try {
    await waitUntil(() => probes.every((probe) => existsSync(probe.readyPath)));
    writeFileSync(path.resolve(barrierRoot, "release"), "go\n", { flag: "wx" });
    const childResults = await Promise.all(probes.map((probe) => probe.result));
    for (const result of childResults) assert.equal(result.code, 0, result.output);
    const outcomes = childResults.map((result) => JSON.parse(result.output.trim()));
    const winners = outcomes.filter((outcome) => outcome.status === "won");
    const losers = outcomes.filter((outcome) => outcome.status === "lost");

    assert.equal(winners.length, 1, JSON.stringify(outcomes));
    assert.equal(losers.length, 1, JSON.stringify(outcomes));
    [winner] = winners;
    assert.equal(winner.manifestWritten, true);
    assert.equal(losers[0].manifestWriteRejected, true);
    assert.equal(losers[0].teardownResult, "not-owner");

    const { ownerPath, manifestPath } = ownershipPaths(E2E_PERSIST_PATH);
    const owner = JSON.parse(readFileSync(ownerPath, "utf8"));
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    assert.equal(owner.runToken, token);
    assert.equal(owner.acquisitionId, winner.acquisitionId);
    assert.equal(manifest.acquisitionId, winner.acquisitionId);
    const claims = readdirSync(E2E_PERSIST_PATH).filter((name) => name.startsWith("claim-"));
    assert.deepEqual(claims, [`claim-${winner.acquisitionId}.txt`]);
  } finally {
    if (winner !== null && existsSync(E2E_PERSIST_PATH)) {
      await teardownOwnedRun({
        persistencePath: E2E_PERSIST_PATH,
        runToken: winner.runToken,
        acquisitionId: winner.acquisitionId,
        ports: DEFAULT_E2E_PORTS,
        gracefulTimeoutMs: 0,
        forcedTimeoutMs: 0,
      });
    }
    rmSync(E2E_PERSIST_PATH, { recursive: true, force: true });
    rmSync(barrierRoot, { recursive: true, force: true });
  }
});

test("ownerless crash residue blocks acquisition unchanged", async (context) => {
  if (existsSync(E2E_PERSIST_PATH)) {
    context.skip("the fixed E2E persistence path already belongs to another run");
    return;
  }
  const token = runToken();
  const sentinelPath = path.resolve(E2E_PERSIST_PATH, "ownerless-crash-residue.txt");
  mkdirSync(E2E_PERSIST_PATH, { recursive: true });
  writeFileSync(sentinelPath, "inspect before operator removal\n");
  try {
    const ownership = await import("./e2e-run-ownership.mjs");
    assert.equal(typeof ownership.acquireRunPersistence, "function");
    assert.throws(
      () => ownership.acquireRunPersistence(
        E2E_PERSIST_PATH,
        token,
        DEFAULT_E2E_PORTS,
        runToken(),
      ),
      /already exists|acquire/i,
    );
    assert.equal(readFileSync(sentinelPath, "utf8"), "inspect before operator removal\n");
    assert.equal(existsSync(ownershipPaths(E2E_PERSIST_PATH).ownerPath), false);
  } finally {
    rmSync(E2E_PERSIST_PATH, { recursive: true, force: true });
  }
});
