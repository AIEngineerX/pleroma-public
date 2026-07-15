import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  E2E_PERSIST_PATH,
  E2E_TMP_ROOT,
  REPOSITORY_ROOT,
  assertRunToken,
  assertSafePersistencePath,
  directoryBelongsToRun,
  e2eOrigins,
  processIdentityMarker,
  readE2EPorts,
  shutdownRequestedFor,
  terminateOwnedProcess,
  writeRunManifest,
  writeRunOwner,
} from "./e2e-run-ownership.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);

export { REPOSITORY_ROOT, E2E_TMP_ROOT, E2E_PERSIST_PATH, assertSafePersistencePath };
export const TEST_PULSE_MINT = "9C6hybhQ6Aycep9jaUnP6uL9ZYvDjUp1aSkFWPUFJtpj";

const WORKER_ROOT = path.resolve(REPOSITORY_ROOT, "worker");
const WEB_ROOT = path.resolve(REPOSITORY_ROOT, "web");
const WRANGLER_CLI = path.resolve(WORKER_ROOT, "node_modules/wrangler/bin/wrangler.js");
const WRANGLER_CONFIG = path.resolve(WORKER_ROOT, "wrangler.toml");
const VITE_CLI = path.resolve(WEB_ROOT, "node_modules/vite/bin/vite.js");
const TEST_ULID_MODULE = path.resolve(WEB_ROOT, "e2e/fixtures/worker-ulid.mjs");
const managedChildren = [];
let shuttingDown = false;
let cleanupComplete = false;
let shutdownWatcher;
let activeRunToken = null;
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
  const argumentPorts = readE2EPorts({
    PLEROMA_E2E_WEB_PORT: oneArgument(argv, "pleroma-e2e-web-port"),
    PLEROMA_E2E_WORKER_PORT: oneArgument(argv, "pleroma-e2e-worker-port"),
  });
  if (
    argumentPorts.web !== environmentPorts.web
    || argumentPorts.worker !== environmentPorts.worker
  ) throw new Error("E2E launcher port configuration does not match its environment");
  return { runToken: argumentToken, ports: argumentPorts };
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

function runCommand(label, cwd, command, args, env = process.env) {
  console.log(`[e2e-stack] ${label}`);
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} exited with status ${String(result.status)}`);
  }
}

function writeProcessManifest() {
  if (activeRunToken === null) return;
  if (activePorts === null) return;
  writeRunManifest(E2E_PERSIST_PATH, activeRunToken, {
    harness: { pid: process.pid, role: "harness", tree: false },
    children: managedChildren
      .filter(({ child }) => child.pid && child.exitCode === null)
      .map(({ descriptor }) => descriptor),
  }, activePorts);
}

function cleanup() {
  if (cleanupComplete) return;
  cleanupComplete = true;
  if (shutdownWatcher) clearInterval(shutdownWatcher);
  if (
    activeRunToken !== null
    && activePorts !== null
    && directoryBelongsToRun(E2E_PERSIST_PATH, activeRunToken, activePorts)
  ) {
    for (const { descriptor } of [...managedChildren].reverse()) {
      terminateOwnedProcess(E2E_PERSIST_PATH, activeRunToken, descriptor, activePorts);
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

function spawnManaged(label, role, cwd, script, args, env = process.env) {
  if (activeRunToken === null) throw new Error("E2E run ownership is not initialized");
  console.log(`[e2e-stack] starting ${label}`);
  const child = spawn(process.execPath, [
    `--title=${processIdentityMarker(activeRunToken, role)}`,
    script,
    ...args,
  ], {
    cwd,
    env,
    detached: process.platform !== "win32",
    stdio: "inherit",
    windowsHide: true,
  });
  if (!child.pid) throw new Error(`${label} did not receive a process ID`);
  const descriptor = { pid: child.pid, role, tree: true };
  managedChildren.push({ child, descriptor });
  writeProcessManifest();
  child.once("error", (error) => {
    if (shuttingDown) return;
    console.error(`[e2e-stack] ${label} failed to start`, error);
    shutdown(1);
  });
  child.once("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(`[e2e-stack] ${label} exited unexpectedly (${signal ?? code ?? "unknown"})`);
    shutdown(typeof code === "number" && code !== 0 ? code : 1);
  });
  return child;
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
  activePorts = configuration.ports;
  const origins = e2eOrigins(activePorts);
  process.once("SIGINT", () => shutdown(0));
  process.once("SIGTERM", () => shutdown(0));
  process.once("exit", cleanup);

  await requireFreePort("127.0.0.1", activePorts.worker);
  await requireFreePort("localhost", activePorts.web);

  const persistencePath = assertSafePersistencePath();
  if (existsSync(persistencePath)) {
    throw new Error(`Refusing to replace E2E persistence without this run's owner token: ${persistencePath}`);
  }
  mkdirSync(persistencePath, { recursive: true });
  writeRunOwner(persistencePath, activeRunToken, activePorts);
  writeProcessManifest();
  const wranglerConfigPath = writeE2EWranglerConfig(persistencePath);
  shutdownWatcher = setInterval(() => {
    if (
      activeRunToken !== null
      && activePorts !== null
      && shutdownRequestedFor(persistencePath, activeRunToken, activePorts)
    ) shutdown(0);
  }, 100);

  const npmCli = npmCliPath();
  runCommand(
    "compiling Worker Doctrine",
    REPOSITORY_ROOT,
    process.execPath,
    [npmCli, "run", "compile:doctrine", "--prefix", WORKER_ROOT],
  );
  runCommand(
    "applying isolated D1 migrations",
    WORKER_ROOT,
    process.execPath,
    [WRANGLER_CLI, "d1", "migrations", "apply", "pleroma", "--local", "--persist-to", persistencePath],
  );

  const childEnv = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };
  spawnManaged(
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

  runCommand(
    "building the web application against the local Worker",
    REPOSITORY_ROOT,
    process.execPath,
    [npmCli, "run", "build", "--prefix", WEB_ROOT],
    { ...process.env, VITE_API_BASE: origins.worker },
  );
  spawnManaged(
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
