import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEARDOWN_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(TEARDOWN_PATH), "../..");
const E2E_TMP_ROOT = path.resolve(REPOSITORY_ROOT, ".tmp");
const E2E_PERSIST_PATH = path.resolve(E2E_TMP_ROOT, "e2e-worker");
const PROCESS_MANIFEST_PATH = path.resolve(E2E_PERSIST_PATH, "stack-processes.json");
const SHUTDOWN_REQUEST_PATH = path.resolve(E2E_PERSIST_PATH, "shutdown-requested");

interface ProcessManifest {
  harnessPid: number;
  children: number[];
}

function comparablePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function assertSafePersistencePath(candidate = E2E_PERSIST_PATH): string {
  const tmpPrefix = `${comparablePath(E2E_TMP_ROOT)}${path.sep}`;
  if (!comparablePath(candidate).startsWith(tmpPrefix)) {
    throw new Error(`Refusing to clean persistence outside ${E2E_TMP_ROOT}: ${candidate}`);
  }
  return path.resolve(candidate);
}

function validPid(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function readManifest(): ProcessManifest | null {
  if (!existsSync(PROCESS_MANIFEST_PATH)) return null;
  const parsed = JSON.parse(readFileSync(PROCESS_MANIFEST_PATH, "utf8")) as Partial<ProcessManifest>;
  if (!validPid(parsed.harnessPid) || !Array.isArray(parsed.children) || !parsed.children.every(validPid)) {
    throw new Error(`Invalid E2E process manifest at ${PROCESS_MANIFEST_PATH}`);
  }
  return { harnessPid: parsed.harnessPid, children: parsed.children };
}

function terminateTree(pid: number): void {
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

function terminateHarness(pid: number): void {
  if (process.platform === "win32") {
    terminateTree(pid);
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForHarnessCleanup(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!existsSync(E2E_PERSIST_PATH)) return true;
    await delay(100);
  }
  return !existsSync(E2E_PERSIST_PATH);
}

export default async function globalTeardown(): Promise<void> {
  const persistencePath = assertSafePersistencePath();
  if (!existsSync(persistencePath)) return;

  const manifest = readManifest();
  writeFileSync(SHUTDOWN_REQUEST_PATH, "shutdown\n");
  if (await waitForHarnessCleanup(10_000)) return;

  if (manifest) {
    for (const pid of [...manifest.children].reverse()) terminateTree(pid);
    terminateHarness(manifest.harnessPid);
  }
  if (await waitForHarnessCleanup(3_000)) return;
  rmSync(persistencePath, { recursive: true, force: true });
}
