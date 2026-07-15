import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  E2E_PERSIST_PATH,
  E2E_TMP_ROOT,
  REPOSITORY_ROOT,
  acquireRunPersistence,
  assertAcquisitionId,
  assertRunToken,
  assertSafePersistencePath,
  directoryBelongsToRun,
  e2eOrigins,
  processIdentityMarker,
  readE2EPorts,
  readOwnedManifest,
  shutdownRequestedFor,
  terminateOwnedProcess,
  writeRunManifest,
} from "./e2e-run-ownership.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);

export { REPOSITORY_ROOT, E2E_TMP_ROOT, E2E_PERSIST_PATH, assertSafePersistencePath };
export const TEST_PULSE_MINT = "9C6hybhQ6Aycep9jaUnP6uL9ZYvDjUp1aSkFWPUFJtpj";

const WORKER_ROOT = path.resolve(REPOSITORY_ROOT, "worker");
const WEB_ROOT = path.resolve(REPOSITORY_ROOT, "web");
const WRANGLER_CLI = path.resolve(WORKER_ROOT, "node_modules/wrangler/bin/wrangler.js");
const WRANGLER_CONFIG = path.resolve(WORKER_ROOT, "wrangler.toml");
const VITE_CLI = path.resolve(WEB_ROOT, "node_modules/vite/bin/vite.js");
const MANAGED_COMMAND = path.resolve(WEB_ROOT, "scripts/e2e-managed-command.mjs");
const TEST_ULID_MODULE = path.resolve(WEB_ROOT, "e2e/fixtures/worker-ulid.mjs");
const MANAGED_READY_TIMEOUT_MS = 10_000;
const managedChildren = [];
let shuttingDown = false;
let cleanupComplete = false;
let shutdownWatcher;
let activeRunToken = null;
let activeAcquisitionId = null;
let activePorts = null;

function oneArgument(argv, name) {
  const prefix = `--${name}=`;
  const matches = argv.filter((value) => value.startsWith(prefix));
  if (matches.length !== 1) throw new Error(`E2E launcher requires one ${name} argument`);
  return matches[0].slice(prefix.length);
}

export function launcherRunConfiguration(argv = process.argv, env = process.env) {
  const ownerArguments = argv.filter((value) => value.startsWith("--pleroma-e2e-owner="));
  const roleArguments = argv.filter((value) => value.startsWith("--pleroma-e2e-role="));
  if (ownerArguments.length !== 1 || roleArguments.length !== 1) {
    throw new Error("E2E launcher requires one ownership token and the harness role");
  }
  if (roleArguments[0] !== "--pleroma-e2e-role=harness") {
    throw new Error("E2E launcher role must be harness");
  }
  const argumentToken = assertRunToken(ownerArguments[0].slice("--pleroma-e2e-owner=".length));
  const environmentToken = assertRunToken(env.PLEROMA_E2E_RUN_TOKEN);
  if (argumentToken !== environmentToken) {
    throw new Error("E2E launcher ownership token does not match its environment");
  }
  const environmentPorts = readE2EPorts(env);
  const argumentAcquisition = assertAcquisitionId(oneArgument(argv, "pleroma-e2e-acquisition"));
  const environmentAcquisition = assertAcquisitionId(env.PLEROMA_E2E_ACQUISITION_ID);
  if (argumentAcquisition !== environmentAcquisition) {
    throw new Error("E2E launcher acquisition ID does not match its environment");
  }
  const argumentPorts = readE2EPorts({
    PLEROMA_E2E_WEB_PORT: oneArgument(argv, "pleroma-e2e-web-port"),
    PLEROMA_E2E_WORKER_PORT: oneArgument(argv, "pleroma-e2e-worker-port"),
  });
  if (
    argumentPorts.web !== environmentPorts.web
    || argumentPorts.worker !== environmentPorts.worker
  ) throw new Error("E2E launcher port configuration does not match its environment");
  return {
    runToken: argumentToken,
    acquisitionId: argumentAcquisition,
    ports: argumentPorts,
  };
}

function tomlPath(filePath) {
  return filePath.replaceAll("\\", "/");
}

export function writeE2EWranglerConfig(persistencePath) {
  const safePath = assertSafePersistencePath(persistencePath);
  const source = readFileSync(WRANGLER_CONFIG, "utf8");
  const mainDeclaration = /^main = "src\/index\.ts"$/gm;
  if ([...source.matchAll(mainDeclaration)].length !== 1) {
    throw new Error("E2E Wrangler config expected one authoritative Worker main declaration");
  }
  const configPath = path.resolve(safePath, "wrangler.e2e.toml");
  const config = source.replace(
    mainDeclaration,
    `main = ${JSON.stringify(tomlPath(path.resolve(WORKER_ROOT, "src/index.ts")))}`,
  ) + `\n[alias]\nulid = ${JSON.stringify(tomlPath(TEST_ULID_MODULE))}\n`;
  writeFileSync(configPath, config);
  return configPath;
}

function npmCliPath() {
  const npmExecPath = process.env.npm_execpath;
  if (!npmExecPath) {
    throw new Error("npm_execpath is unavailable; start Playwright through npm run e2e");
  }
  return path.resolve(npmExecPath);
}

function writeProcessManifest() {
  if (activeRunToken === null) return;
  if (activeAcquisitionId === null) return;
  if (activePorts === null) return;
  writeRunManifest(E2E_PERSIST_PATH, activeRunToken, {
    harness: { pid: process.pid, role: "harness", tree: false },
    children: managedChildren
      .filter(({ child }) => (
        child.pid
        && child.exitCode === null
        && child.signalCode === null
      ))
      .map(({ descriptor }) => descriptor),
  }, activePorts, activeAcquisitionId);
}

function cleanup() {
  if (cleanupComplete) return;
  cleanupComplete = true;
  if (shutdownWatcher) clearInterval(shutdownWatcher);
  if (
    activeRunToken !== null
    && activeAcquisitionId !== null
    && activePorts !== null
    && directoryBelongsToRun(
      E2E_PERSIST_PATH,
      activeRunToken,
      activePorts,
      activeAcquisitionId,
    )
  ) {
    for (const { descriptor } of [...managedChildren].reverse()) {
      terminateOwnedProcess(
        E2E_PERSIST_PATH,
        activeRunToken,
        descriptor,
        activePorts,
        activeAcquisitionId,
      );
    }
  }
}

function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    cleanup();
  } finally {
    process.exit(exitCode);
  }
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

function waitForManagedReady(child, label) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      finish(() => reject(new Error(`Timed out waiting for ${label} wrapper readiness`)));
    }, MANAGED_READY_TIMEOUT_MS);
    const onMessage = (message) => {
      if (message?.type === "pleroma-e2e-command-ready") finish(resolve);
    };
    const onError = (error) => finish(() => reject(error));
    const onExit = (code, signal) => finish(() => reject(new Error(
      `${label} wrapper exited before readiness (${signal ?? code ?? "unknown"})`,
    )));
    function finish(settle) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.removeListener("message", onMessage);
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      settle();
    }
    child.on("message", onMessage);
    child.once("error", onError);
    child.once("exit", onExit);
    child.send({ type: "pleroma-e2e-command-probe" }, (error) => {
      if (error) onError(error);
    });
  });
}

function managedTargetExit(child, label) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const onMessage = (message) => {
      if (message?.type !== "pleroma-e2e-target-exit") return;
      finish(() => resolve({ code: message.code, signal: message.signal }));
    };
    const onError = (error) => finish(() => reject(error));
    const onExit = (code, signal) => finish(() => reject(new Error(
      `${label} wrapper exited before target result (${signal ?? code ?? "unknown"})`,
    )));
    function finish(settle) {
      if (settled) return;
      settled = true;
      child.removeListener("message", onMessage);
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      settle();
    }
    child.on("message", onMessage);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

function forgetManagedEntry(entry) {
  const index = managedChildren.indexOf(entry);
  if (index !== -1) managedChildren.splice(index, 1);
}

function assertDescriptorPublished(descriptor) {
  if (activeRunToken === null || activeAcquisitionId === null || activePorts === null) {
    throw new Error("E2E run ownership is not initialized");
  }
  const manifest = readOwnedManifest(
    E2E_PERSIST_PATH,
    activeRunToken,
    activePorts,
    activeAcquisitionId,
  );
  const published = manifest !== null
    && [manifest.harness, ...manifest.children].some((candidate) => (
      candidate.pid === descriptor.pid
      && candidate.role === descriptor.role
      && candidate.tree === descriptor.tree
    ));
  if (!published) throw new Error("Refusing to start an E2E target without its exact wrapper descriptor");
}

async function retireFailedManagedEntry(entry, published) {
  if (published) {
    const terminated = terminateOwnedProcess(
      E2E_PERSIST_PATH,
      activeRunToken,
      entry.descriptor,
      activePorts,
      activeAcquisitionId,
    );
    if (!terminated) throw new Error("Could not retire the published E2E wrapper after launch failure");
  } else {
    if (entry.child.connected) entry.child.disconnect();
    if (entry.child.exitCode === null && entry.child.signalCode === null) {
      entry.child.kill("SIGTERM");
    }
  }
  await childExit(entry.child);
  forgetManagedEntry(entry);
  if (published) writeProcessManifest();
}

async function sendManagedMessage(child, message) {
  if (!child.connected || child.exitCode !== null || child.signalCode !== null) {
    throw new Error("E2E wrapper IPC is unavailable");
  }
  await new Promise((resolve, reject) => {
    child.send(message, (error) => error ? reject(error) : resolve());
  });
}

async function spawnOwnedNode(label, role, cwd, script, args, env = process.env) {
  if (
    activeRunToken === null
    || activeAcquisitionId === null
    || activePorts === null
  ) throw new Error("E2E run ownership is not initialized");
  console.log(`[e2e-stack] starting ${label}`);
  const child = spawn(process.execPath, [
    `--title=${processIdentityMarker(activeRunToken, role)}`,
    MANAGED_COMMAND,
    script,
    ...args,
  ], {
    cwd,
    env,
    detached: process.platform !== "win32",
    stdio: ["inherit", "inherit", "inherit", "ipc"],
    windowsHide: true,
  });
  if (!child.pid) throw new Error(`${label} did not receive a process ID`);
  const descriptor = { pid: child.pid, role, tree: true };
  const entry = { child, descriptor, targetExit: null };
  managedChildren.push(entry);
  let published = false;
  try {
    await waitForManagedReady(child, label);
    writeProcessManifest();
    published = true;
    assertDescriptorPublished(descriptor);
    entry.targetExit = managedTargetExit(child, label);
    await sendManagedMessage(child, { type: "pleroma-e2e-start" });
    return entry;
  } catch (error) {
    entry.targetExit?.catch(() => {});
    try {
      await retireFailedManagedEntry(entry, published);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `${label} wrapper launch and cleanup failed`,
      );
    }
    throw error;
  }
}

async function runManagedCommand(label, cwd, script, args, env = process.env) {
  console.log(`[e2e-stack] ${label}`);
  const entry = await spawnOwnedNode(
    label,
    "startup",
    cwd,
    script,
    args,
    env,
  );
  const result = await entry.targetExit;
  if (result.signal !== null || result.code !== 0) {
    throw new Error(`${label} exited with ${result.signal ?? `status ${String(result.code)}`}`);
  }
}

async function spawnManaged(label, role, cwd, script, args, env = process.env) {
  const entry = await spawnOwnedNode(label, role, cwd, script, args, env);
  entry.targetExit.then(
    ({ code, signal }) => {
      if (shuttingDown) return;
      console.error(`[e2e-stack] ${label} exited unexpectedly (${signal ?? code ?? "unknown"})`);
      shutdown(typeof code === "number" && code !== 0 ? code : 1);
    },
    (error) => {
      if (shuttingDown) return;
      console.error(`[e2e-stack] ${label} wrapper failed`, error);
      shutdown(1);
    },
  );
  return entry.child;
}

function isListening(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (listening) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(750);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

async function requireFreePort(host, port) {
  if (await isListening(host, port)) {
    throw new Error(`Refusing to start: ${host}:${port} is already listening`);
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForResponse(url, timeoutMs, validate) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok && await validate(response)) return;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}`, { cause: lastError });
}

async function main() {
  const configuration = launcherRunConfiguration();
  activeRunToken = configuration.runToken;
  activeAcquisitionId = configuration.acquisitionId;
  activePorts = configuration.ports;
  const origins = e2eOrigins(activePorts);
  process.once("SIGINT", () => shutdown(0));
  process.once("SIGTERM", () => shutdown(0));
  process.once("exit", cleanup);
  process.on("message", (message) => {
    if (
      message?.type === "pleroma-e2e-shutdown"
      && message.runToken === process.env.PLEROMA_E2E_RUN_TOKEN
      && message.acquisitionId === process.env.PLEROMA_E2E_ACQUISITION_ID
    ) shutdown(0);
  });

  await requireFreePort("127.0.0.1", activePorts.worker);
  await requireFreePort("localhost", activePorts.web);

  const persistencePath = assertSafePersistencePath();
  acquireRunPersistence(
    persistencePath,
    activeRunToken,
    activePorts,
    activeAcquisitionId,
  );
  writeProcessManifest();
  const wranglerConfigPath = writeE2EWranglerConfig(persistencePath);
  shutdownWatcher = setInterval(() => {
    if (
      activeRunToken !== null
      && activeAcquisitionId !== null
      && activePorts !== null
      && shutdownRequestedFor(
        persistencePath,
        activeRunToken,
        activePorts,
        activeAcquisitionId,
      )
    ) shutdown(0);
  }, 100);

  const npmCli = npmCliPath();
  await runManagedCommand(
    "compiling Worker Doctrine",
    REPOSITORY_ROOT,
    npmCli,
    ["run", "compile:doctrine", "--prefix", WORKER_ROOT],
  );
  await runManagedCommand(
    "applying isolated D1 migrations",
    WORKER_ROOT,
    WRANGLER_CLI,
    ["d1", "migrations", "apply", "pleroma", "--local", "--persist-to", persistencePath],
  );

  const childEnv = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };
  await spawnManaged(
    "local Worker",
    "worker",
    WORKER_ROOT,
    WRANGLER_CLI,
    [
      "dev",
      "--local",
      "--config", wranglerConfigPath,
      "--port", String(activePorts.worker),
      "--persist-to", persistencePath,
      "--var", `CORS_ORIGIN:${origins.web}`,
      "--var", `PULSE_MINT:${TEST_PULSE_MINT}`,
    ],
    childEnv,
  );
  await waitForResponse(`${origins.worker}/api/health`, 60_000, async (response) => {
    const body = await response.json();
    return body?.ok === true;
  });

  await runManagedCommand(
    "building the web application against the local Worker",
    REPOSITORY_ROOT,
    npmCli,
    ["run", "build", "--prefix", WEB_ROOT],
    { ...process.env, VITE_API_BASE: origins.worker },
  );
  await spawnManaged(
    "Vite preview",
    "web",
    WEB_ROOT,
    VITE_CLI,
    ["preview", "--host", "localhost", "--port", String(activePorts.web), "--strictPort"],
    process.env,
  );
  await waitForResponse(`${origins.web}/`, 60_000, async () => true);
  console.log("[e2e-stack] Worker, D1, R2, and built web preview are ready");
  await new Promise(() => {});
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch((error) => {
    console.error("[e2e-stack] startup failed", error);
    shutdown(1);
  });
}
