import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);

export const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "../..");
export const E2E_TMP_ROOT = path.resolve(REPOSITORY_ROOT, ".tmp");
export const E2E_PERSIST_PATH = path.resolve(E2E_TMP_ROOT, "e2e-worker");
export const TEST_PULSE_MINT = "9C6hybhQ6Aycep9jaUnP6uL9ZYvDjUp1aSkFWPUFJtpj";

const PROCESS_MANIFEST_PATH = path.resolve(E2E_PERSIST_PATH, "stack-processes.json");
const SHUTDOWN_REQUEST_PATH = path.resolve(E2E_PERSIST_PATH, "shutdown-requested");
const WORKER_ROOT = path.resolve(REPOSITORY_ROOT, "worker");
const WEB_ROOT = path.resolve(REPOSITORY_ROOT, "web");
const WRANGLER_CLI = path.resolve(WORKER_ROOT, "node_modules/wrangler/bin/wrangler.js");
const VITE_CLI = path.resolve(WEB_ROOT, "node_modules/vite/bin/vite.js");
const managedChildren = [];
let shuttingDown = false;
let cleanupComplete = false;
let ownsPersistence = false;
let shutdownWatcher;

function comparablePath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function assertSafePersistencePath(candidate = E2E_PERSIST_PATH) {
  const tmpPrefix = `${comparablePath(E2E_TMP_ROOT)}${path.sep}`;
  if (!comparablePath(candidate).startsWith(tmpPrefix)) {
    throw new Error(`Refusing to clean persistence outside ${E2E_TMP_ROOT}: ${candidate}`);
  }
  return path.resolve(candidate);
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
  writeFileSync(PROCESS_MANIFEST_PATH, JSON.stringify({
    harnessPid: process.pid,
    children: managedChildren
      .filter((child) => child.pid && child.exitCode === null)
      .map((child) => child.pid),
  }));
}

function terminateTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function cleanup() {
  if (cleanupComplete) return;
  cleanupComplete = true;
  if (shutdownWatcher) clearInterval(shutdownWatcher);
  for (const child of managedChildren.reverse()) terminateTree(child);
  if (ownsPersistence) {
    rmSync(assertSafePersistencePath(), { recursive: true, force: true });
    ownsPersistence = false;
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

function spawnManaged(label, cwd, command, args, env = process.env) {
  console.log(`[e2e-stack] starting ${label}`);
  const child = spawn(command, args, {
    cwd,
    env,
    detached: process.platform !== "win32",
    stdio: "inherit",
    windowsHide: true,
  });
  managedChildren.push(child);
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
  process.once("SIGINT", () => shutdown(0));
  process.once("SIGTERM", () => shutdown(0));
  process.once("exit", cleanup);

  await requireFreePort("127.0.0.1", 8787);
  await requireFreePort("localhost", 4173);

  const persistencePath = assertSafePersistencePath();
  rmSync(persistencePath, { recursive: true, force: true });
  mkdirSync(persistencePath, { recursive: true });
  ownsPersistence = true;
  writeProcessManifest();
  shutdownWatcher = setInterval(() => {
    if (existsSync(SHUTDOWN_REQUEST_PATH)) shutdown(0);
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
    WORKER_ROOT,
    process.execPath,
    [
      WRANGLER_CLI,
      "dev",
      "--local",
      "--port", "8787",
      "--persist-to", persistencePath,
      "--var", "CORS_ORIGIN:http://localhost:4173",
      "--var", `PULSE_MINT:${TEST_PULSE_MINT}`,
    ],
    childEnv,
  );
  await waitForResponse("http://127.0.0.1:8787/api/health", 60_000, async (response) => {
    const body = await response.json();
    return body?.ok === true;
  });

  runCommand(
    "building the web application against the local Worker",
    REPOSITORY_ROOT,
    process.execPath,
    [npmCli, "run", "build", "--prefix", WEB_ROOT],
    { ...process.env, VITE_API_BASE: "http://127.0.0.1:8787" },
  );
  spawnManaged(
    "Vite preview",
    WEB_ROOT,
    process.execPath,
    [VITE_CLI, "preview", "--host", "localhost", "--port", "4173", "--strictPort"],
    process.env,
  );
  await waitForResponse("http://localhost:4173/", 60_000, async () => true);
  console.log("[e2e-stack] Worker, D1, R2, and built web preview are ready");
  await new Promise(() => {});
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch((error) => {
    console.error("[e2e-stack] startup failed", error);
    shutdown(1);
  });
}
