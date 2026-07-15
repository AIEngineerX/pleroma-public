import { spawn } from "node:child_process";

const readyPath = process.env.PLEROMA_E2E_STARTUP_READY;
if (!readyPath) throw new Error("PLEROMA_E2E_STARTUP_READY is required");

const blockedProgram = [
  'const { spawn } = require("node:child_process");',
  'const { writeFileSync } = require("node:fs");',
  `const readyPath = ${JSON.stringify(readyPath)};`,
  "const descendant = spawn(process.execPath, [\"-e\", \"setInterval(() => {}, 1000)\"], {",
  '  stdio: "ignore",',
  "  windowsHide: true,",
  "});",
  'if (!descendant.pid) throw new Error("blocked startup descendant has no process ID");',
  "writeFileSync(readyPath, JSON.stringify({",
  "  childPid: process.pid,",
  "  descendantPid: descendant.pid,",
  "}));",
  "setInterval(() => {}, 1000);",
].join("\n");
const blocked = spawn(
  process.execPath,
  ["-e", blockedProgram],
  {
    detached: process.platform === "win32",
    stdio: "ignore",
    windowsHide: true,
  },
);
if (!blocked.pid) throw new Error("blocked startup command has no process ID");
await new Promise((resolve, reject) => {
  blocked.once("error", reject);
  blocked.once("exit", resolve);
});
