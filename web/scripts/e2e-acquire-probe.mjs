import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as ownership from "./e2e-run-ownership.mjs";

const [
  persistencePath,
  runToken,
  acquisitionId,
  readyPath,
  releasePath,
  webPort,
  workerPort,
] = process.argv.slice(2);
const ports = { web: Number(webPort), worker: Number(workerPort) };
const existedBeforeBarrier = existsSync(persistencePath);
writeFileSync(readyPath, "ready\n", { flag: "wx" });
while (!existsSync(releasePath)) {
  await new Promise((resolve) => setTimeout(resolve, 5));
}

let acquired = false;
try {
  if (typeof ownership.acquireRunPersistence === "function") {
    ownership.acquireRunPersistence(persistencePath, runToken, ports, acquisitionId);
  } else {
    if (existedBeforeBarrier) throw new Error("persistence existed before unsafe acquisition");
    ownership.writeRunOwner(persistencePath, runToken, ports);
  }
  acquired = true;
} catch {
  // Report the losing path below.
}

if (acquired) {
  let manifestWritten = false;
  try {
    ownership.writeRunManifest(persistencePath, runToken, {
      harness: { pid: process.pid, role: "harness", tree: false },
      children: [],
    }, ports, acquisitionId);
    manifestWritten = true;
  } catch {
    // Unsafe acquisition can already have lost ownership to the racing process.
  }
  writeFileSync(path.resolve(persistencePath, `claim-${acquisitionId}.txt`), "claimed\n");
  process.stdout.write(`${JSON.stringify({
    status: "won",
    runToken,
    acquisitionId,
    manifestWritten,
  })}\n`);
} else {
  let ownerRewriteRejected = typeof ownership.writeRunOwner !== "function";
  if (!ownerRewriteRejected) {
    try {
      ownership.writeRunOwner(persistencePath, runToken, ports);
    } catch {
      ownerRewriteRejected = true;
    }
  }
  let manifestWriteRejected = false;
  try {
    ownership.writeRunManifest(persistencePath, runToken, {
      harness: { pid: process.pid, role: "harness", tree: false },
      children: [],
    }, ports, acquisitionId);
  } catch {
    manifestWriteRejected = true;
  }
  const teardownResult = await ownership.teardownOwnedRun({
    persistencePath,
    runToken,
    ports,
    acquisitionId,
    gracefulTimeoutMs: 0,
    forcedTimeoutMs: 0,
    deletionTimeoutMs: 0,
  });
  process.stdout.write(`${JSON.stringify({
    status: "lost",
    runToken,
    acquisitionId,
    ownerRewriteRejected,
    manifestWriteRejected,
    teardownResult,
  })}\n`);
}
