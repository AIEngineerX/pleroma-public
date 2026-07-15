import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const WINDOWS_JOB_HOST = path.resolve(SCRIPT_ROOT, "e2e-windows-job.ps1");

const marker = process.argv[2];
const targetUsesIpc = process.argv[3] === "1";
const target = process.argv[4];
const args = process.argv.slice(5);
if (!marker || !target) throw new Error("owned E2E launch gate requires a marker and target");

let started = false;
let targetChild = null;
process.on("message", (message) => {
  if (message?.type === "pleroma-e2e-start" && !started) {
    started = true;
    const targetArguments = [
      `--title=${marker}`,
      target,
      ...args,
    ];
    const command = process.platform === "win32" ? "powershell.exe" : process.execPath;
    const commandArguments = process.platform === "win32"
      ? [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy", "Bypass",
          "-File", WINDOWS_JOB_HOST,
          process.execPath,
          process.cwd(),
          Buffer.from(JSON.stringify(targetArguments), "utf8").toString("base64"),
        ]
      : targetArguments;
    targetChild = spawn(command, commandArguments, {
      cwd: process.cwd(),
      env: process.env,
      stdio: process.platform !== "win32" && targetUsesIpc
        ? ["inherit", "inherit", "inherit", "ipc"]
        : "inherit",
      windowsHide: true,
    });
    targetChild.once("error", (error) => {
      console.error("[e2e-launch-gate] target failed to start", error);
      process.exit(1);
    });
    targetChild.once("exit", (code, signal) => {
      targetChild = null;
      process.send?.({ type: "pleroma-e2e-target-exit", code, signal });
    });
    return;
  }
  if (started && targetUsesIpc && targetChild?.connected) targetChild.send(message);
});

process.once("disconnect", () => {
  if (!started) process.exit(1);
});

process.send?.({ type: "pleroma-e2e-gate-ready" });
