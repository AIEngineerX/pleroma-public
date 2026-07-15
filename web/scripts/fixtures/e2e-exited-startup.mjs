import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const readyPath = process.env.PLEROMA_E2E_STARTUP_READY;
if (!readyPath) throw new Error("PLEROMA_E2E_STARTUP_READY is required");
const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  detached: process.platform === "win32",
  stdio: "ignore",
  windowsHide: true,
});
if (!descendant.pid) throw new Error("startup descendant did not receive a process ID");
descendant.unref();
writeFileSync(readyPath, JSON.stringify({
  wrapperPid: process.ppid,
  targetPid: process.pid,
  descendantPid: descendant.pid,
}));
