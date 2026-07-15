import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { test } from "@playwright/test";

test("holds a real Playwright worker and descendant", async () => {
  const readyPath = process.env.PLEROMA_E2E_PLAYWRIGHT_READY;
  if (!readyPath) throw new Error("PLEROMA_E2E_PLAYWRIGHT_READY is required");
  const descendant = spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    { stdio: "ignore", windowsHide: true },
  );
  if (!descendant.pid) throw new Error("Playwright descendant has no process ID");
  writeFileSync(
    readyPath,
    JSON.stringify({ workerPid: process.pid, descendantPid: descendant.pid }),
  );
  await new Promise(() => {});
});
