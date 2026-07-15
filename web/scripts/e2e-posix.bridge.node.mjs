import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(SCRIPT_ROOT, "..");

test("POSIX ownership regressions pass natively or through WSL", (context) => {
  if (process.platform !== "win32") {
    const result = spawnSync(
      process.execPath,
      ["--test", "scripts/e2e-posix.ownership.node.mjs"],
      { cwd: WEB_ROOT, encoding: "utf8" },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    return;
  }

  const translated = spawnSync(
    "wsl.exe",
    ["wslpath", "-a", WEB_ROOT.replaceAll("\\", "/")],
    { encoding: "utf8", windowsHide: true },
  );
  if (translated.error || translated.status !== 0 || !translated.stdout.trim()) {
    context.skip("WSL with Node is unavailable");
    return;
  }
  const nodeProbe = spawnSync(
    "wsl.exe",
    ["bash", "-lc", "command -v node >/dev/null 2>&1 && node --version >/dev/null 2>&1"],
    { encoding: "utf8", windowsHide: true },
  );
  if (nodeProbe.error || nodeProbe.status !== 0) {
    context.skip("WSL is present but Node is unavailable");
    return;
  }
  const result = spawnSync(
    "wsl.exe",
    [
      "bash",
      "-lc",
      'cd "$1" && node --test scripts/e2e-posix.ownership.node.mjs',
      "pleroma-posix-test",
      translated.stdout.trim(),
    ],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024, windowsHide: true },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
