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

function commandLineBelongsToRun(commandLine, runToken, role) {
  const titleMarker = `--title=${processIdentityMarker(runToken, role)}`;
  if (commandLine.includes(titleMarker)) return true;
  return role === "harness"
    && commandLine.includes(`--pleroma-e2e-owner=${runToken}`)
    && commandLine.includes("--pleroma-e2e-role=harness");
}

function nonWindowsProcessCommandLine(pid) {
  if (!validPid(pid)) return null;
  try {
    const commandLine = readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ");
    if (commandLine) return commandLine;
  } catch {
    // Fall through for platforms without procfs.
  }
  const result = spawnSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" });
  return result.status === 0 && result.stdout ? result.stdout : null;
}

const WINDOWS_IDENTITY_ATTEMPTS = 3;
const WINDOWS_SNAPSHOT_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$rows = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CreationDate, @{Name='CreationTimeMs'; Expression={ ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() }}, @{Name='CreationTimeTicks'; Expression={ ([DateTimeOffset]$_.CreationDate).UtcDateTime.Ticks.ToString() }}, CommandLine)",
  "[Console]::Out.Write((ConvertTo-Json -InputObject $rows -Compress -Depth 3))",
].join("; ");

function validWindowsCreationTimeMs(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validWindowsCreationTimeTicks(value) {
  return typeof value === "string" && /^(?:0|[1-9]\d*)$/.test(value);
}

export function windowsProcessRecordFromSnapshotRow(row) {
  const pid = Number(row?.ProcessId);
  const parentPid = Number(row?.ParentProcessId);
  if (!validPid(pid) || !Number.isSafeInteger(parentPid) || parentPid < 0) return null;
  return {
    pid,
    parentPid,
    creationDate: typeof row.CreationDate === "string" && row.CreationDate
      ? row.CreationDate
      : null,
    creationTimeMs: validWindowsCreationTimeMs(row.CreationTimeMs)
      ? row.CreationTimeMs
      : null,
    creationTimeTicks: validWindowsCreationTimeTicks(row.CreationTimeTicks)
      ? row.CreationTimeTicks
      : null,
    commandLine: typeof row.CommandLine === "string" ? row.CommandLine : null,
  };
}

function windowsProcessSnapshot() {
  const result = spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_SNAPSHOT_SCRIPT],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024, windowsHide: true },
  );
  if (result.error || result.status !== 0 || !result.stdout) {
    return { state: "probe-error" };
  }
  try {
    const rows = JSON.parse(result.stdout);
    if (!Array.isArray(rows)) return { state: "probe-error" };
    const processes = new Map();
    for (const row of rows) {
      const record = windowsProcessRecordFromSnapshotRow(row);
      if (record !== null) processes.set(record.pid, record);
    }
    return { state: "ok", processes };
  } catch {
    return { state: "probe-error" };
  }
}

export function windowsProcessIncarnationState(current, expected) {
  if (current === undefined) return "absent";
  if (
    typeof current?.creationDate !== "string"
    || !current.creationDate
    || !validWindowsCreationTimeMs(current.creationTimeMs)
    || !validWindowsCreationTimeTicks(current.creationTimeTicks)
    || typeof expected?.creationDate !== "string"
    || !expected.creationDate
    || !validWindowsCreationTimeMs(expected.creationTimeMs)
    || !validWindowsCreationTimeTicks(expected.creationTimeTicks)
  ) return "unavailable";
  return current.creationDate === expected.creationDate
    && current.creationTimeMs === expected.creationTimeMs
    && current.creationTimeTicks === expected.creationTimeTicks
    ? "same"
    : "reused";
}

export function windowsProcessDescendantEdgeState(parent, child) {
  if (child?.parentPid !== parent?.pid) return "not-child";
  if (
    typeof parent?.creationDate !== "string"
    || !parent.creationDate
    || !validWindowsCreationTimeMs(parent.creationTimeMs)
    || !validWindowsCreationTimeTicks(parent.creationTimeTicks)
    || typeof child?.creationDate !== "string"
    || !child.creationDate
    || !validWindowsCreationTimeMs(child.creationTimeMs)
    || !validWindowsCreationTimeTicks(child.creationTimeTicks)
  ) return "unavailable";
  const parentTicks = BigInt(parent.creationTimeTicks);
  const childTicks = BigInt(child.creationTimeTicks);
  if (childTicks < parentTicks) return "stale-parent";
  if (childTicks === parentTicks) return "unavailable";
  return "possible-child";
}

function windowsDescendants(snapshot, rootRecord) {
  const descendants = [];
  const queue = [{ ...rootRecord, depth: 0 }];
  const seen = new Set([rootRecord.pid]);
  while (queue.length > 0) {
    const parent = queue.shift();
    for (const processRecord of snapshot.processes.values()) {
      if (seen.has(processRecord.pid)) continue;
      const edgeState = windowsProcessDescendantEdgeState(parent, processRecord);
      if (edgeState === "not-child" || edgeState === "stale-parent") continue;
      if (edgeState === "unavailable") {
        return { state: "unavailable", records: descendants };
      }
      seen.add(processRecord.pid);
      const descendant = { ...processRecord, depth: parent.depth + 1 };
      descendants.push(descendant);
      queue.push(descendant);
    }
  }
  return { state: "ok", records: descendants };
}

function windowsRecordKey(record) {
  return `${record.pid}:${record.creationTimeTicks}`;
}

function uniqueWindowsRecords(records) {
  const unique = new Map();
  for (const record of records) {
    const key = windowsRecordKey(record);
    const existing = unique.get(key);
    if (!existing || (record.depth ?? 0) > (existing.depth ?? 0)) unique.set(key, record);
  }
  return [...unique.values()];
}

function classifyWindowsDescriptor(snapshot, descriptor, runToken) {
  if (snapshot.state !== "ok") return { state: "unavailable" };
  const root = snapshot.processes.get(descriptor.pid);
  if (root === undefined) {
    if (
      descriptor.tree
      && [...snapshot.processes.values()].some((record) => record.parentPid === descriptor.pid)
    ) {
      return { state: "unavailable" };
    }
    return { state: "absent" };
  }
  if (
    root.creationDate === null
    || root.creationTimeMs === null
    || root.creationTimeTicks === null
    || root.commandLine === null
  ) return { state: "unavailable" };
  if (!commandLineBelongsToRun(root.commandLine, runToken, descriptor.role)) {
    return { state: "mismatch", record: { ...root, depth: 0 } };
  }
  const lineage = descriptor.tree
    ? windowsDescendants(snapshot, root)
    : { state: "ok", records: [] };
  if (lineage.state === "unavailable") return { state: "unavailable" };
  const descendants = lineage.records;
  if (descendants.some((record) => (
    record.creationDate === null
    || record.creationTimeMs === null
    || record.creationTimeTicks === null
  ))) {
    return { state: "unavailable" };
  }
  const rootRecord = { ...root, depth: 0 };
  return {
    state: "match",
    proof: {
      descriptor: { ...descriptor },
      root: rootRecord,
      records: uniqueWindowsRecords([rootRecord, ...descendants]),
    },
  };
}

function inspectWindowsDescriptorSync(descriptor, runToken) {
  let consecutiveAbsences = 0;
  for (let attempt = 0; attempt < WINDOWS_IDENTITY_ATTEMPTS; attempt += 1) {
    const identity = classifyWindowsDescriptor(windowsProcessSnapshot(), descriptor, runToken);
    if (identity.state === "match" || identity.state === "mismatch") return identity;
    if (identity.state === "absent") {
      consecutiveAbsences += 1;
      if (consecutiveAbsences >= 2) return identity;
    } else {
      consecutiveAbsences = 0;
    }
  }
  return { state: "unavailable" };
}

function taskkillWindows(pid) {
  return spawnSync(
    "taskkill.exe",
    ["/PID", String(pid), "/F"],
    { stdio: "ignore", windowsHide: true },
  );
}

function terminateWindowsRecord(record, { runToken, role } = {}) {
  const snapshot = windowsProcessSnapshot();
  if (snapshot.state !== "ok") return "identity-unavailable";
  const current = snapshot.processes.get(record.pid);
  const incarnation = windowsProcessIncarnationState(current, record);
  if (incarnation === "unavailable") return "identity-unavailable";
  if (incarnation === "absent" || incarnation === "reused") return "absent";
  if (runToken !== undefined) {
    if (current.commandLine === null) return "identity-unavailable";
    if (!commandLineBelongsToRun(current.commandLine, runToken, role)) return "foreign-process";
  }
  // CreationDate is revalidated immediately before taskkill. Without a retained Windows
  // process handle or Job Object, this final probe-to-kill interval cannot be atomic.
  const result = taskkillWindows(record.pid);
  if (result.error) return "identity-unavailable";
  if (result.status === 0) return "terminated";
  const verification = windowsProcessSnapshot();
  if (verification.state !== "ok") return "identity-unavailable";
  const verifiedIncarnation = windowsProcessIncarnationState(
    verification.processes.get(record.pid),
    record,
  );
  if (verifiedIncarnation === "unavailable") return "identity-unavailable";
  return verifiedIncarnation === "same" ? "processes-running" : "absent";
}

function inspectWindowsProofLineage(snapshot, proof, knownRecords) {
  if (snapshot.state !== "ok") {
    return { status: "identity-unavailable", records: knownRecords };
  }
  const currentRoot = snapshot.processes.get(proof.root.pid);
  const rootIncarnation = windowsProcessIncarnationState(currentRoot, proof.root);
  if (rootIncarnation === "unavailable") {
    return { status: "identity-unavailable", records: knownRecords };
  }
  if (rootIncarnation === "same") {
    if (currentRoot.commandLine === null) {
      return { status: "identity-unavailable", records: knownRecords };
    }
    if (!commandLineBelongsToRun(currentRoot.commandLine, proof.runToken, proof.descriptor.role)) {
      return { status: "foreign-process", records: knownRecords };
    }
  }

  const lineage = proof.descriptor.tree
    ? windowsDescendants(snapshot, proof.root)
    : { state: "ok", records: [] };
  if (lineage.state === "unavailable") {
    return { status: "identity-unavailable", records: knownRecords };
  }
  const descendants = lineage.records;
  if (descendants.some((record) => (
    record.creationDate === null
    || record.creationTimeMs === null
    || record.creationTimeTicks === null
  ))) return { status: "identity-unavailable", records: knownRecords };

  const known = new Set(knownRecords.map(windowsRecordKey));
  if (rootIncarnation !== "same") {
    const unproven = descendants.filter((record) => !known.has(windowsRecordKey(record)));
    if (unproven.length > 0) {
      return { status: "identity-unavailable", records: knownRecords };
    }
    return { status: "root-retired", records: knownRecords };
  }
  return {
    status: "root-present",
    records: uniqueWindowsRecords([...knownRecords, ...descendants]),
  };
}

function windowsRecordsState(snapshot, records) {
  if (snapshot.state !== "ok") return "identity-unavailable";
  let running = false;
  for (const record of uniqueWindowsRecords(records)) {
    const incarnation = windowsProcessIncarnationState(snapshot.processes.get(record.pid), record);
    if (incarnation === "unavailable") return "identity-unavailable";
    if (incarnation === "same") running = true;
  }
  return running ? "processes-running" : "exited";
}

function terminateWindowsOwnedProof(proof, runToken) {
  const ownedProof = { ...proof, runToken };
  let records = [...ownedProof.records];
  let status = "terminated";

  for (let attempt = 0; attempt < WINDOWS_IDENTITY_ATTEMPTS; attempt += 1) {
    const lineage = inspectWindowsProofLineage(windowsProcessSnapshot(), ownedProof, records);
    records = lineage.records;
    if (lineage.status === "identity-unavailable" || lineage.status === "foreign-process") {
      return { status: lineage.status, records };
    }

    const descendants = records
      .filter((record) => windowsRecordKey(record) !== windowsRecordKey(ownedProof.root))
      .sort((left, right) => (right.depth ?? 0) - (left.depth ?? 0));
    for (const descendant of descendants) {
      const result = terminateWindowsRecord(descendant);
      if (result === "identity-unavailable") status = result;
      else if (result === "processes-running" && status !== "identity-unavailable") {
        status = result;
      }
    }
    if (status === "identity-unavailable") return { status, records };

    const rootResult = terminateWindowsRecord(ownedProof.root, {
      runToken,
      role: ownedProof.descriptor.role,
    });
    if (rootResult === "foreign-process" || rootResult === "identity-unavailable") {
      return { status: rootResult, records };
    }
    if (rootResult === "processes-running") status = rootResult;

    const snapshot = windowsProcessSnapshot();
    const completion = windowsRecordsState(snapshot, records);
    const postKillLineage = inspectWindowsProofLineage(snapshot, ownedProof, records);
    records = postKillLineage.records;
    if (
      postKillLineage.status === "identity-unavailable"
      || postKillLineage.status === "foreign-process"
    ) return { status: postKillLineage.status, records };
    if (completion === "exited" && postKillLineage.status === "root-retired") {
      return { status: "terminated", records };
    }
  }

  const finalSnapshot = windowsProcessSnapshot();
  const finalLineage = inspectWindowsProofLineage(finalSnapshot, ownedProof, records);
  records = finalLineage.records;
  if (finalLineage.status === "identity-unavailable" || finalLineage.status === "foreign-process") {
    return { status: finalLineage.status, records };
  }
  return { status: windowsRecordsState(finalSnapshot, records), records };
}

function auditWindowsOwnedProofs(proofs, records, runToken) {
  const snapshot = windowsProcessSnapshot();
  if (snapshot.state !== "ok") return { status: "identity-unavailable", records };
  let observed = uniqueWindowsRecords(records);
  for (const proof of proofs) {
    const lineage = inspectWindowsProofLineage(
      snapshot,
      { ...proof, runToken },
      observed,
    );
    observed = lineage.records;
    if (lineage.status === "identity-unavailable" || lineage.status === "foreign-process") {
      return { status: lineage.status, records: observed };
    }
  }
  return { status: windowsRecordsState(snapshot, observed), records: observed };
}

export function processBelongsToRunSync(pid, runToken, role) {
  const token = assertRunToken(runToken);
  const processRole = assertRole(role);
  if (process.platform === "win32") {
    return inspectWindowsDescriptorSync(
      { pid, role: processRole, tree: false },
      token,
    ).state === "match";
  }
  const commandLine = nonWindowsProcessCommandLine(pid);
  if (commandLine === null) return false;
  return commandLineBelongsToRun(commandLine, token, processRole);
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
  if (process.platform === "win32") {
    const identity = inspectWindowsDescriptorSync(descriptor, token);
    if (identity.state === "absent") return true;
    if (identity.state !== "match") return false;
    return terminateWindowsOwnedProof(identity.proof, token).status === "terminated";
  }
  if (!isProcessAlive(descriptor.pid)) return true;
  if (!processBelongsToRunSync(descriptor.pid, token, descriptor.role)) return false;
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

async function waitForWindowsRecordsToExit(records, timeoutMs) {
  const expected = uniqueWindowsRecords(records);
  if (expected.length === 0) return "exited";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = windowsProcessSnapshot();
    if (windowsRecordsState(snapshot, expected) === "exited") return "exited";
    await delay(25);
  }
  return windowsRecordsState(windowsProcessSnapshot(), expected);
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
  forcedTimeoutMs = process.platform === "win32" ? 15_000 : 3_000,
  deletionTimeoutMs = 30_000,
} = {}) {
  const safePath = assertSafePersistencePath(persistencePath);
  const token = assertRunToken(runToken);
  const normalizedPorts = normalizePorts(ports);
  if (!existsSync(safePath)) return "absent";
  if (!directoryBelongsToRun(safePath, token, normalizedPorts)) return "not-owner";
  const manifest = readOwnedManifest(safePath, token, normalizedPorts);
  if (manifest === null) return "invalid-manifest";

  const descriptors = [...manifest.children].reverse().concat(manifest.harness);
  const windowsIdentities = new Map();
  let foundForeignProcess = false;
  let identityUnavailable = false;
  let observedWindowsRecords = [];
  const windowsProofs = [];
  if (process.platform === "win32") {
    for (const descriptor of descriptors) {
      if (!existsSync(safePath)) return "cleaned";
      if (!directoryBelongsToRun(safePath, token, normalizedPorts)) return "ownership-lost";
      const currentManifest = readOwnedManifest(safePath, token, normalizedPorts);
      if (currentManifest === null || !manifestContains(currentManifest, descriptor)) {
        return "ownership-lost";
      }
      const identity = inspectWindowsDescriptorSync(descriptor, token);
      windowsIdentities.set(`${descriptor.role}:${descriptor.pid}:${descriptor.tree}`, identity);
      if (identity.state === "match") {
        windowsProofs.push(identity.proof);
        observedWindowsRecords.push(...identity.proof.records);
      } else if (identity.state === "mismatch") {
        foundForeignProcess = true;
        observedWindowsRecords.push(identity.record);
      } else if (identity.state === "unavailable") {
        identityUnavailable = true;
      }
    }
  }

  const { shutdownPath } = ownershipPaths(safePath);
  if (
    !directoryBelongsToRun(safePath, token, normalizedPorts)
    || readOwnedManifest(safePath, token, normalizedPorts) === null
  ) {
    return "ownership-lost";
  }
  writeFileSync(shutdownPath, JSON.stringify({ runToken: token, ports: normalizedPorts }));
  if (await waitForDirectoryRemoval(safePath, gracefulTimeoutMs)) return "cleaned";

  if (process.platform === "win32") {
    for (const descriptor of descriptors) {
      if (!existsSync(safePath)) return "cleaned";
      if (!directoryBelongsToRun(safePath, token, normalizedPorts)) return "ownership-lost";
      const currentManifest = readOwnedManifest(safePath, token, normalizedPorts);
      if (currentManifest === null || !manifestContains(currentManifest, descriptor)) {
        return "ownership-lost";
      }
      const identity = windowsIdentities.get(`${descriptor.role}:${descriptor.pid}:${descriptor.tree}`);
      if (identity?.state !== "match") continue;
      const termination = terminateWindowsOwnedProof(identity.proof, token);
      observedWindowsRecords.push(...termination.records);
      if (termination.status === "foreign-process") foundForeignProcess = true;
      if (termination.status === "identity-unavailable") identityUnavailable = true;
    }
    const waitResult = await waitForWindowsRecordsToExit(
      observedWindowsRecords,
      forcedTimeoutMs,
    );
    if (foundForeignProcess) return "foreign-process";
    if (identityUnavailable || waitResult === "identity-unavailable") {
      return "identity-unavailable";
    }
    if (waitResult === "processes-running") return "processes-running";
    const finalAudit = auditWindowsOwnedProofs(
      windowsProofs,
      observedWindowsRecords,
      token,
    );
    if (finalAudit.status === "foreign-process") return "foreign-process";
    if (finalAudit.status === "identity-unavailable") return "identity-unavailable";
    if (finalAudit.status === "processes-running") return "processes-running";
  } else {
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
    const exited = await waitForProcessesToExit(descriptors, forcedTimeoutMs);
    if (foundForeignProcess) return "foreign-process";
    if (!exited) return "processes-running";
  }

  if (!existsSync(safePath)) return "cleaned";
  if (!directoryBelongsToRun(safePath, token, normalizedPorts)) return "ownership-lost";
  const finalManifest = readOwnedManifest(safePath, token, normalizedPorts);
  if (finalManifest === null) return "ownership-lost";
  if (process.platform !== "win32") {
    const liveDescriptors = [...finalManifest.children, finalManifest.harness]
      .filter((descriptor) => isProcessAlive(descriptor.pid));
    if (liveDescriptors.length > 0) return "processes-running";
  }
  return await removeOwnedPersistence(safePath, token, normalizedPorts, deletionTimeoutMs)
    ? "cleaned"
    : "ownership-lost";
}
