import path from "node:path";
import { fileURLToPath } from "node:url";

// Shared constants for the E2E stack: one fixed, path-asserted persistence directory and
// fixed local ports. One run at a time by design — Playwright's webServer fails fast on a
// busy port, which is the whole concurrency guard (Maker decision 2026-07-16, replacing the
// process-ownership harness with the stock Playwright lifecycle).
const SCRIPT_ROOT = path.dirname(fileURLToPath(import.meta.url));
export const WEB_ROOT = path.resolve(SCRIPT_ROOT, "..");
export const REPOSITORY_ROOT = path.resolve(WEB_ROOT, "..");
export const WORKER_ROOT = path.resolve(REPOSITORY_ROOT, "worker");
export const E2E_TMP_ROOT = path.resolve(REPOSITORY_ROOT, ".tmp");
export const E2E_PERSIST_PATH = path.resolve(E2E_TMP_ROOT, "e2e-worker");

export const E2E_PORTS = { web: 4173, worker: 8787 };
export const E2E_ORIGINS = {
  web: `http://localhost:${E2E_PORTS.web}`,
  worker: `http://127.0.0.1:${E2E_PORTS.worker}`,
};

export const TEST_PULSE_MINT = "9C6hybhQ6Aycep9jaUnP6uL9ZYvDjUp1aSkFWPUFJtpj";

// The only destructive operation the harness performs is deleting the persistence directory;
// this assertion pins it inside the repository's .tmp before any caller may do so.
export function assertSafePersistencePath() {
  const relative = path.relative(E2E_TMP_ROOT, E2E_PERSIST_PATH);
  if (relative.startsWith("..") || path.isAbsolute(relative) || relative.length === 0) {
    throw new Error(`E2E persistence path escaped ${E2E_TMP_ROOT}: ${E2E_PERSIST_PATH}`);
  }
  return E2E_PERSIST_PATH;
}
