import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_PATH = fileURLToPath(import.meta.url);
const RUN_TOKEN = /^[a-f0-9]{64}$/;
const PROCESS_ROLE = /^[a-z][a-z0-9-]*$/;

export const REPOSITORY_ROOT = path.resolve(path.dirname(MODULE_PATH), "../..");
export const E2E_TMP_ROOT = path.resolve(REPOSITORY_ROOT, ".tmp");
export const E2E_PERSIST_PATH = path.resolve(E2E_TMP_ROOT, "e2e-worker");
export const DEFAULT_E2E_PORTS = Object.freeze({ web: 4173, worker: 8787 });

function readPort(value, fallback, label) {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^[1-9]\d{0,4}$/.test(value)) {
    throw new Error(`PLEROMA E2E ${label} port must be an integer from 1024 through 65535`);
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) {
    throw new Error(`PLEROMA E2E ${label} port must be an integer from 1024 through 65535`);
  }
  return port;
}

export function readE2EPorts(env = process.env) {
  const ports = {
    web: readPort(env.PLEROMA_E2E_WEB_PORT, DEFAULT_E2E_PORTS.web, "web"),
    worker: readPort(env.PLEROMA_E2E_WORKER_PORT, DEFAULT_E2E_PORTS.worker, "worker"),
  };
  if (ports.web === ports.worker) throw new Error("PLEROMA E2E web and worker ports must differ");
  return ports;
}

function normalizePorts(value = DEFAULT_E2E_PORTS) {
  if (
    value === null
    || typeof value !== "object"
    || !Number.isSafeInteger(value.web)
    || value.web < 1024
    || value.web > 65_535
    || !Number.isSafeInteger(value.worker)
    || value.worker < 1024
    || value.worker > 65_535
    || value.web === value.worker
  ) throw new Error("Invalid PLEROMA E2E port ownership");
  return { web: value.web, worker: value.worker };
}

function portsMatch(left, right) {
  return left !== null
    && typeof left === "object"
    && left.web === right.web
    && left.worker === right.worker
    && Object.keys(left).length === 2;
}

export function e2eOrigins(ports = DEFAULT_E2E_PORTS) {
  const normalized = normalizePorts(ports);
  return {
    web: `http://localhost:${normalized.web}`,
    worker: `http://127.0.0.1:${normalized.worker}`,
  };
}

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

export function assertRunToken(value) {
  if (typeof value !== "string" || !RUN_TOKEN.test(value)) {
    throw new Error("PLEROMA E2E ownership token must be 32 random bytes encoded as lowercase hex");
  }
  return value;
}

function assertRole(value) {
  if (typeof value !== "string" || !PROCESS_ROLE.test(value)) {
    throw new Error(`Invalid PLEROMA E2E process role: ${String(value)}`);
  }
  return value;
}

export function processIdentityMarker(runToken, role) {
  return `pleroma-e2e:${assertRole(role)}:${assertRunToken(runToken)}`;
}

export function ownershipPaths(persistencePath = E2E_PERSIST_PATH) {
  const safePath = assertSafePersistencePath(persistencePath);
  return {
    persistencePath: safePath,
    ownerPath: path.resolve(safePath, "run-owner.json"),
    manifestPath: path.resolve(safePath, "stack-processes.json"),
    shutdownPath: path.resolve(safePath, "shutdown-requested"),
  };
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function directoryBelongsToRun(persistencePath, runToken, ports = DEFAULT_E2E_PORTS) {
  const token = assertRunToken(runToken);
  const normalizedPorts = normalizePorts(ports);
  const { ownerPath } = ownershipPaths(persistencePath);
  const owner = readJson(ownerPath);
  return owner !== null
    && typeof owner === "object"
    && owner.runToken === token
    && portsMatch(owner.ports, normalizedPorts)
    && Object.keys(owner).length === 2;
}

export function writeRunOwner(persistencePath, runToken, ports = DEFAULT_E2E_PORTS) {
  const token = assertRunToken(runToken);
  const normalizedPorts = normalizePorts(ports);
  const { persistencePath: safePath, ownerPath } = ownershipPaths(persistencePath);
  mkdirSync(safePath, { recursive: true });
  writeFileSync(ownerPath, JSON.stringify({ runToken: token, ports: normalizedPorts }));
}

function validPid(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validProcessDescriptor(value) {
  return value !== null
    && typeof value === "object"
    && validPid(value.pid)
    && typeof value.role === "string"
    && PROCESS_ROLE.test(value.role)
    && typeof value.tree === "boolean";
}

export function readOwnedManifest(persistencePath, runToken, ports = DEFAULT_E2E_PORTS) {
  const token = assertRunToken(runToken);
  const normalizedPorts = normalizePorts(ports);
  const { manifestPath } = ownershipPaths(persistencePath);
  const manifest = readJson(manifestPath);
  if (
    manifest === null
    || typeof manifest !== "object"
    || manifest.runToken !== token
    || !portsMatch(manifest.ports, normalizedPorts)
    || !validProcessDescriptor(manifest.harness)
    || !Array.isArray(manifest.children)
    || !manifest.children.every(validProcessDescriptor)
  ) return null;
  return {
    runToken: token,
    ports: normalizedPorts,
    harness: { ...manifest.harness },
    children: manifest.children.map((child) => ({ ...child })),
  };
}

export function writeRunManifest(
  persistencePath,
  runToken,
  manifest,
  ports = DEFAULT_E2E_PORTS,
) {
  const token = assertRunToken(runToken);
  const normalizedPorts = normalizePorts(ports);
  if (!directoryBelongsToRun(persistencePath, token, normalizedPorts)) {
    throw new Error("Refusing to write an E2E manifest without matching directory ownership");
  }
  const candidate = { runToken: token, ports: normalizedPorts, ...manifest };
  if (
    !validProcessDescriptor(candidate.harness)
    || !Array.isArray(candidate.children)
    || !candidate.children.every(validProcessDescriptor)
  ) throw new Error("Invalid E2E process manifest");
  const { manifestPath } = ownershipPaths(persistencePath);
  writeFileSync(manifestPath, JSON.stringify(candidate));
}

export function shutdownRequestedFor(persistencePath, runToken, ports = DEFAULT_E2E_PORTS) {
  const token = assertRunToken(runToken);
  const normalizedPorts = normalizePorts(ports);
  const { shutdownPath } = ownershipPaths(persistencePath);
  const request = readJson(shutdownPath);
  return request !== null
    && typeof request === "object"
    && request.runToken === token
    && portsMatch(request.ports, normalizedPorts)
    && Object.keys(request).length === 2;
}

export function isProcessAlive(pid) {
  if (!validPid(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function processCommandLine(pid) {
  if (!validPid(pid)) return null;
  if (process.platform === "win32") {
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$p = Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\"; if ($null -ne $p) { [Console]::Out.Write($p.CommandLine) }`,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    return result.status === 0 && result.stdout ? result.stdout : null;
  }
  try {
    const commandLine = readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ");
    if (commandLine) return commandLine;
  } catch {
    // Fall through for platforms without procfs.
  }
  const result = spawnSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" });
  return result.status === 0 && result.stdout ? result.stdout : null;
}

export function processBelongsToRunSync(pid, runToken, role) {
  const token = assertRunToken(runToken);
  const processRole = assertRole(role);
  const commandLine = processCommandLine(pid);
  if (commandLine === null) return false;
  const titleMarker = `--title=${processIdentityMarker(token, processRole)}`;
  if (commandLine.includes(titleMarker)) return true;
  return processRole === "harness"
    && commandLine.includes(`--pleroma-e2e-owner=${token}`)
    && commandLine.includes("--pleroma-e2e-role=harness");
}

export async function processBelongsToRun(pid, runToken, role) {
  return processBelongsToRunSync(pid, runToken, role);
}

function manifestContains(manifest, descriptor) {
  return [manifest.harness, ...manifest.children].some((candidate) => (
    candidate.pid === descriptor.pid
    && candidate.role === descriptor.role
    && candidate.tree === descriptor.tree
  ));
}

export function terminateOwnedProcess(
  persistencePath,
  runToken,
  descriptor,
  ports = DEFAULT_E2E_PORTS,
) {
  const token = assertRunToken(runToken);
  const normalizedPorts = normalizePorts(ports);
  if (!directoryBelongsToRun(persistencePath, token, normalizedPorts)) return false;
  const manifest = readOwnedManifest(persistencePath, token, normalizedPorts);
  if (manifest === null || !manifestContains(manifest, descriptor)) return false;
  if (!isProcessAlive(descriptor.pid)) return true;
  if (!processBelongsToRunSync(descriptor.pid, token, descriptor.role)) return false;
  if (process.platform === "win32") {
    const result = spawnSync(
      "taskkill.exe",
      ["/PID", String(descriptor.pid), ...(descriptor.tree ? ["/T"] : []), "/F"],
      { stdio: "ignore", windowsHide: true },
    );
    return result.status === 0 || !isProcessAlive(descriptor.pid);
  }
  try {
    process.kill(descriptor.tree ? -descriptor.pid : descriptor.pid, "SIGTERM");
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return true;
    throw error;
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForDirectoryRemoval(persistencePath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!existsSync(persistencePath)) return true;
    await delay(25);
  }
  return !existsSync(persistencePath);
}

async function waitForProcessesToExit(descriptors, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (descriptors.every((descriptor) => !isProcessAlive(descriptor.pid))) return true;
    await delay(25);
  }
  return descriptors.every((descriptor) => !isProcessAlive(descriptor.pid));
}

function attemptRemoveOwnedPersistence(persistencePath, runToken, ports) {
  if (!directoryBelongsToRun(persistencePath, runToken, ports)) return false;
  if (readOwnedManifest(persistencePath, runToken, ports) === null) return false;
  const ownershipEvidence = new Set([
    "run-owner.json",
    "stack-processes.json",
    "shutdown-requested",
  ]);
  for (const name of readdirSync(persistencePath)) {
    if (ownershipEvidence.has(name)) continue;
    if (!directoryBelongsToRun(persistencePath, runToken, ports)) return false;
    if (readOwnedManifest(persistencePath, runToken, ports) === null) return false;
    rmSync(path.resolve(persistencePath, name), { recursive: true, force: true });
  }
  if (!directoryBelongsToRun(persistencePath, runToken, ports)) return false;
  if (readOwnedManifest(persistencePath, runToken, ports) === null) return false;
  rmSync(persistencePath, { recursive: true, force: true });
  return true;
}

function retryableRemovalError(error) {
  return error?.code === "EPERM" || error?.code === "EBUSY" || error?.code === "ENOTEMPTY";
}

async function removeOwnedPersistence(persistencePath, runToken, ports, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      return attemptRemoveOwnedPersistence(persistencePath, runToken, ports);
    } catch (error) {
      if (!retryableRemovalError(error) || Date.now() >= deadline) throw error;
      await delay(100);
    }
  }
}

export async function teardownOwnedRun({
  persistencePath = E2E_PERSIST_PATH,
  runToken,
  ports = DEFAULT_E2E_PORTS,
  gracefulTimeoutMs = 10_000,
  forcedTimeoutMs = 3_000,
  deletionTimeoutMs = 10_000,
} = {}) {
  const safePath = assertSafePersistencePath(persistencePath);
  const token = assertRunToken(runToken);
  const normalizedPorts = normalizePorts(ports);
  if (!existsSync(safePath)) return "absent";
  if (!directoryBelongsToRun(safePath, token, normalizedPorts)) return "not-owner";
  const manifest = readOwnedManifest(safePath, token, normalizedPorts);
  if (manifest === null) return "invalid-manifest";

  const { shutdownPath } = ownershipPaths(safePath);
  if (
    !directoryBelongsToRun(safePath, token, normalizedPorts)
    || readOwnedManifest(safePath, token, normalizedPorts) === null
  ) {
    return "ownership-lost";
  }
  writeFileSync(shutdownPath, JSON.stringify({ runToken: token, ports: normalizedPorts }));
  if (await waitForDirectoryRemoval(safePath, gracefulTimeoutMs)) return "cleaned";

  const descriptors = [...manifest.children].reverse().concat(manifest.harness);
  let foundForeignProcess = false;
  for (const descriptor of descriptors) {
    if (!existsSync(safePath)) return "cleaned";
    if (!directoryBelongsToRun(safePath, token, normalizedPorts)) return "ownership-lost";
    const currentManifest = readOwnedManifest(safePath, token, normalizedPorts);
    if (currentManifest === null || !manifestContains(currentManifest, descriptor)) {
      return "ownership-lost";
    }
    if (!isProcessAlive(descriptor.pid)) continue;
    if (!processBelongsToRunSync(descriptor.pid, token, descriptor.role)) {
      foundForeignProcess = true;
      continue;
    }
    terminateOwnedProcess(safePath, token, descriptor, normalizedPorts);
  }

  await waitForProcessesToExit(descriptors, forcedTimeoutMs);
  if (foundForeignProcess) return "foreign-process";
  if (!existsSync(safePath)) return "cleaned";
  if (!directoryBelongsToRun(safePath, token, normalizedPorts)) return "ownership-lost";
  const finalManifest = readOwnedManifest(safePath, token, normalizedPorts);
  if (finalManifest === null) return "ownership-lost";
  const liveDescriptors = [...finalManifest.children, finalManifest.harness]
    .filter((descriptor) => isProcessAlive(descriptor.pid));
  if (liveDescriptors.length > 0) {
    return "processes-running";
  }
  return await removeOwnedPersistence(safePath, token, normalizedPorts, deletionTimeoutMs)
    ? "cleaned"
    : "ownership-lost";
}
