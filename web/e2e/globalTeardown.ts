import { readE2EPorts, teardownOwnedRun } from "../scripts/e2e-run-ownership.mjs";

export default async function globalTeardown(): Promise<void> {
  const runToken = process.env.PLEROMA_E2E_RUN_TOKEN;
  const result = await teardownOwnedRun({
    runToken,
    ports: readE2EPorts(process.env),
    gracefulTimeoutMs: 1_000,
  });
  if (result === "absent" || result === "cleaned") return;
  throw new Error(`E2E teardown stopped without touching unproven state: ${result}`);
}
