import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_ROOT, "../..");
const STACK_SCRIPT = path.resolve(SCRIPT_ROOT, "e2e-stack.mjs");
const PERSISTENCE_PATH = path.resolve(REPOSITORY_ROOT, ".tmp", "e2e-worker");
const SENTINEL_PATH = path.resolve(PERSISTENCE_PATH, "must-survive-port-collision.txt");

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function runStack() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [STACK_SCRIPT], {
      cwd: path.resolve(REPOSITORY_ROOT, "web"),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal, output }));
  });
}

test("an occupied port fails without deleting persistence this harness does not own", async () => {
  const listener = net.createServer();
  let ownsPersistence = false;

  try {
    await listen(listener, 8787, "127.0.0.1");
    rmSync(PERSISTENCE_PATH, { recursive: true, force: true });
    mkdirSync(PERSISTENCE_PATH, { recursive: true });
    ownsPersistence = true;
    writeFileSync(SENTINEL_PATH, "owned by another stack\n");

    const result = await runStack();
    assert.notEqual(result.code, 0, `harness unexpectedly succeeded:\n${result.output}`);
    assert.equal(
      existsSync(SENTINEL_PATH),
      true,
      `harness deleted unowned persistence after a port collision:\n${result.output}`,
    );
  } finally {
    if (listener.listening) await close(listener);
    if (ownsPersistence) rmSync(PERSISTENCE_PATH, { recursive: true, force: true });
  }
});
