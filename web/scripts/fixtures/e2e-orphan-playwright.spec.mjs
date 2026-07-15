import { spawn } from "node:child_process";
import { test } from "@playwright/test";

test("leaves a grandchild behind an exited intermediate", async () => {
  const readyPath = process.env.PLEROMA_E2E_ORPHAN_READY;
  if (!readyPath) throw new Error("PLEROMA_E2E_ORPHAN_READY is required");
  const grandchildProgram = "setInterval(() => {}, 1000)";
  const intermediateProgram = [
    'const { spawn } = require("node:child_process");',
    'const { writeFileSync } = require("node:fs");',
    `const readyPath = ${JSON.stringify(readyPath)};`,
    `const grandchild = spawn(process.execPath, ["-e", ${JSON.stringify(grandchildProgram)}], {`,
    '  detached: process.platform === "win32",',
    '  stdio: "ignore",',
    "  windowsHide: true,",
    "});",
    'if (!grandchild.pid) throw new Error("orphan grandchild has no process ID");',
    "grandchild.unref();",
    "writeFileSync(readyPath, JSON.stringify({",
    "  intermediatePid: process.pid,",
    "  grandchildPid: grandchild.pid,",
    "}));",
  ].join("\n");
  const intermediate = spawn(process.execPath, ["-e", intermediateProgram], {
    stdio: "ignore",
    windowsHide: true,
  });
  await new Promise((resolve, reject) => {
    intermediate.once("error", reject);
    intermediate.once("exit", resolve);
  });
});
