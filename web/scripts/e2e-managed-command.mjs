import { spawn } from "node:child_process";

const target = process.argv[2];
const args = process.argv.slice(3);
if (!target) throw new Error("tracked E2E command requires a target script");

let started = false;
let targetChild = null;
let targetReported = false;

function reportTargetExit(code, signal) {
  if (targetReported) return;
  targetReported = true;
  targetChild = null;
  process.send?.({ type: "pleroma-e2e-target-exit", code, signal });
}

process.on("message", (message) => {
  if (message?.type === "pleroma-e2e-command-probe" && !started) {
    process.send?.({ type: "pleroma-e2e-command-ready" });
    return;
  }
  if (message?.type === "pleroma-e2e-start" && !started) {
    started = true;
    targetChild = spawn(process.execPath, [target, ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    });
    targetChild.once("error", (error) => {
      console.error("[e2e-command] failed to start", error);
      reportTargetExit(1, null);
    });
    targetChild.once("exit", (code, signal) => reportTargetExit(code, signal));
    return;
  }
  if (message?.type === "pleroma-e2e-retire" && started && targetChild === null) {
    process.exit(0);
  }
});

process.once("disconnect", () => {
  if (!started || process.platform === "win32") process.exit(1);
  process.once("SIGTERM", () => {});
  try {
    process.kill(-process.pid, "SIGTERM");
  } catch (error) {
    console.error("[e2e-command] failed to retire disconnected process group", error);
    process.exit(1);
  }
  setTimeout(() => {
    try {
      process.kill(-process.pid, "SIGKILL");
    } catch (error) {
      if (error?.code !== "ESRCH") {
        console.error("[e2e-command] failed to force disconnected process group", error);
      }
    }
    process.exit(1);
  }, 250);
});

process.send?.({ type: "pleroma-e2e-command-ready" });
