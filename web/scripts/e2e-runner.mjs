import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  E2E_PERSIST_PATH,
  E2E_TMP_ROOT,
  acquireRunPersistence,
  assertRunToken,
  e2eOrigins,
  processIdentityMarker,
  readE2EPorts,
  teardownOwnedRun,
  writeRunManifest,
} from "./e2e-run-ownership.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_ROOT = path.dirname(SCRIPT_PATH);
const WEB_ROOT = path.resolve(SCRIPT_ROOT, "..");
const STACK_SCRIPT = path.resolve(SCRIPT_ROOT, "e2e-stack.mjs");
const LAUNCH_GATE = path.resolve(SCRIPT_ROOT, "e2e-launch-gate.mjs");
const PLAYWRIGHT_CLI = path.resolve(WEB_ROOT, "node_modules/@playwright/test/cli.js");
const STACK_STARTUP_TIMEOUT_MS = 180_000;
const GATE_READY_TIMEOUT_MS = 10_000;

function abortError() {
  const error = new Error("PLEROMA E2E run cancelled");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const timeout = setTimeout(finish, milliseconds);
    function finish() {
      signal?.removeEventListener("abort", cancel);
      resolve();
    }
    function cancel() {
      clearTimeout(timeout);
      reject(abortError());
    }
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

function childExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function terminateDirectChild(child) {
  if (child.connected) child.disconnect();
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  await childExit(child);
}

function waitForGateReady(child, kind, signal) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      finish(() => reject(new Error(`Timed out waiting for E2E ${kind} launch gate`)));
    }, GATE_READY_TIMEOUT_MS);
    const onMessage = (message) => {
      if (message?.type === "pleroma-e2e-gate-ready") finish(resolve);
    };
    const onError = (error) => finish(() => reject(error));
    const onAbort = () => finish(() => reject(abortError()));
    const onExit = (code, signal) => finish(() => reject(new Error(
      `E2E ${kind} launch gate exited before readiness (${signal ?? code ?? "unknown"})`,
    )));
    function finish(settle) {
      clearTimeout(timeout);
      child.removeListener("message", onMessage);
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      signal?.removeEventListener("abort", onAbort);
      settle();
    }
    child.on("message", onMessage);
    child.once("error", onError);
    child.once("exit", onExit);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

async function waitForStack(launch, url, signal) {
  const deadline = Date.now() + STACK_STARTUP_TIMEOUT_MS;
  const exited = launch.targetExit.then(
    ({ code, signal: exitSignal }) => new Error(
      `E2E stack exited before readiness (${exitSignal ?? code ?? "unknown"})`,
    ),
    (error) => error,
  );
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    try {
      const requestSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(1_000)])
        : AbortSignal.timeout(1_000);
      const response = await fetch(url, { signal: requestSignal });
      if (response.ok) return;
    } catch (error) {
      if (signal?.aborted) throw abortError();
    }
    const exitError = await Promise.race([
      delay(250, signal).then(() => null),
      exited,
    ]);
    if (exitError !== null) throw exitError;
  }
  throw new Error(`Timed out waiting for E2E stack at ${url}`);
}

async function runTarget(launch, signal) {
  if (!signal) return launch.targetExit;
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    let cancelling = false;
    const cancel = () => {
      if (cancelling) return;
      cancelling = true;
      signal.removeEventListener("abort", cancel);
      Promise.resolve(retireOwnedLaunch(launch)).then(
        () => reject(abortError()),
        reject,
      );
    };
    signal.addEventListener("abort", cancel, { once: true });
    launch.targetExit.then(
      (result) => {
        if (cancelling) return;
        signal.removeEventListener("abort", cancel);
        resolve(result);
      },
      (error) => {
        if (cancelling) return;
        signal.removeEventListener("abort", cancel);
        reject(error);
      },
    );
  });
}

function ownedLaunchPath(kind, token) {
  return path.resolve(E2E_TMP_ROOT, `e2e-runner-${kind}-${token}`);
}

async function spawnOwnedNodeTree({
  kind,
  token,
  role,
  ports,
  script,
  args,
  cwd,
  env,
  ipc = false,
  signal,
}) {
  const persistencePath = ownedLaunchPath(kind, token);
  const acquisitionId = randomBytes(32).toString("hex");
  acquireRunPersistence(persistencePath, token, ports, acquisitionId);
  let child;
  let launch;
  try {
    const marker = processIdentityMarker(token, role);
    child = spawn(process.execPath, [
      `--title=${marker}`,
      LAUNCH_GATE,
      marker,
      ipc ? "1" : "0",
      script,
      ...args,
    ], {
      cwd,
      env,
      detached: process.platform !== "win32",
      stdio: ["inherit", "inherit", "inherit", "ipc"],
      windowsHide: true,
    });
    if (!child.pid) throw new Error(`${kind} did not receive a process ID`);
    await waitForGateReady(child, kind, signal);
    throwIfAborted(signal);
    writeRunManifest(persistencePath, token, {
      harness: { pid: child.pid, role, tree: true },
      children: [],
    }, ports, acquisitionId);
    let targetSettled = false;
    let resolveTarget;
    let rejectTarget;
    const targetExit = new Promise((resolve, reject) => {
      resolveTarget = resolve;
      rejectTarget = reject;
    });
    child.on("message", (message) => {
      if (message?.type !== "pleroma-e2e-target-exit" || targetSettled) return;
      targetSettled = true;
      resolveTarget({ code: message.code, signal: message.signal });
    });
    childExit(child).then(
      ({ code, signal }) => {
        if (targetSettled) return;
        targetSettled = true;
        rejectTarget(new Error(`E2E ${kind} launch gate exited before target result (${signal ?? code ?? "unknown"})`));
      },
      (error) => {
        if (targetSettled) return;
        targetSettled = true;
        rejectTarget(error);
      },
    );
    launch = { child, persistencePath, token, acquisitionId, ports, targetExit };
    throwIfAborted(signal);
    await new Promise((resolve, reject) => {
      child.send({ type: "pleroma-e2e-start" }, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  } catch (error) {
    if (launch === undefined) {
      let cleanupError;
      try {
        if (child !== undefined) await terminateDirectChild(child);
      } catch (failure) {
        cleanupError = failure;
      }
      if (cleanupError !== undefined) {
        throw new AggregateError(
          [error, cleanupError],
          `E2E ${kind} launch publication and cleanup failed`,
        );
      }
      rmSync(persistencePath, { recursive: true, force: true });
    } else {
      await retireOwnedLaunch(launch);
    }
    throw error;
  }
  return launch;
}

async function retireOwnedLaunch(launch, gracefulTimeoutMs = 0) {
  const result = await teardownOwnedRun({
    persistencePath: launch.persistencePath,
    runToken: launch.token,
    acquisitionId: launch.acquisitionId,
    ports: launch.ports,
    gracefulTimeoutMs,
  });
  if (result !== "absent" && result !== "cleaned") {
    throw new Error(`E2E runner could not retire its proven ${result} process tree`);
  }
  await childExit(launch.child);
}

async function runPlaywright(playwrightArgs, env, signal, ports) {
  throwIfAborted(signal);
  const token = randomBytes(32).toString("hex");
  const launch = await spawnOwnedNodeTree({
    kind: "playwright",
    token,
    role: "playwright",
    ports,
    script: PLAYWRIGHT_CLI,
    args: ["test", ...playwrightArgs],
    cwd: WEB_ROOT,
    env,
    signal,
  });
  try {
    const result = await runTarget(launch, signal);
    return result.code ?? 1;
  } finally {
    if (existsSync(launch.persistencePath)) await retireOwnedLaunch(launch);
  }
}

function requestStackShutdown(stack, runToken, acquisitionId) {
  if (!stack.connected || stack.exitCode !== null || stack.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    stack.send({ type: "pleroma-e2e-shutdown", runToken, acquisitionId }, () => resolve());
  });
}

async function retireStack({
  stackLaunch,
  runToken,
  acquisitionId,
  ports,
}) {
  const errors = [];
  try {
    await requestStackShutdown(stackLaunch.child, runToken, acquisitionId);
    const teardownResult = await teardownOwnedRun({
      persistencePath: E2E_PERSIST_PATH,
      runToken,
      acquisitionId,
      ports,
      gracefulTimeoutMs: 1_000,
    });
    if (
      teardownResult !== "absent"
      && teardownResult !== "cleaned"
    ) {
      throw new Error(`E2E runner stopped without touching unproven state: ${teardownResult}`);
    }
  } catch (error) {
    errors.push(error);
  }
  try {
    await retireOwnedLaunch(stackLaunch);
  } catch (error) {
    errors.push(error);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    const detail = errors.map((error) => error?.message ?? String(error)).join("; ");
    throw new AggregateError(errors, `E2E runner stack cleanup failed: ${detail}`);
  }
}

export async function runOwnedE2E({
  env = process.env,
  playwrightArgs = process.argv.slice(2),
  signal,
} = {}) {
  throwIfAborted(signal);
  if (env.PLEROMA_PRODUCTION_GATE === "1") {
    return runPlaywright(playwrightArgs, env, signal, readE2EPorts({}));
  }

  const runToken = env.PLEROMA_E2E_RUN_TOKEN === undefined
    ? randomBytes(32).toString("hex")
    : assertRunToken(env.PLEROMA_E2E_RUN_TOKEN);
  const ports = readE2EPorts(env);
  const origins = e2eOrigins(ports);
  if (existsSync(E2E_PERSIST_PATH)) {
    throw new Error(`Refusing to start: E2E persistence already exists at ${E2E_PERSIST_PATH}`);
  }
  const acquisitionId = randomBytes(32).toString("hex");
  const childEnv = {
    ...env,
    PLEROMA_E2E_RUN_TOKEN: runToken,
    PLEROMA_E2E_WEB_PORT: String(ports.web),
    PLEROMA_E2E_WORKER_PORT: String(ports.worker),
    PLEROMA_E2E_ACQUISITION_ID: acquisitionId,
  };
  const stackLaunch = await spawnOwnedNodeTree({
    kind: "stack",
    token: runToken,
    role: "harness",
    ports,
    script: STACK_SCRIPT,
    args: [
      `--pleroma-e2e-owner=${runToken}`,
      "--pleroma-e2e-role=harness",
      `--pleroma-e2e-web-port=${ports.web}`,
      `--pleroma-e2e-worker-port=${ports.worker}`,
      `--pleroma-e2e-acquisition=${acquisitionId}`,
    ],
    cwd: WEB_ROOT,
    env: childEnv,
    ipc: true,
    signal,
  });
  try {
    await waitForStack(stackLaunch, `${origins.web}/`, signal);
    throwIfAborted(signal);
    return await runPlaywright(playwrightArgs, childEnv, signal, ports);
  } finally {
    await retireStack({
      stackLaunch,
      runToken,
      acquisitionId,
      ports,
    });
  }
}

async function main() {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    process.exitCode = await runOwnedE2E({ signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      process.exitCode = 130;
      return;
    }
    console.error("[e2e-runner] failed", error);
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  await main();
}
