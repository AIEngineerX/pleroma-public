import { readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const forbidden = [
  "worker/src/",
  "VOICE, STATIC SYSTEM PROMPT",
  "Reply with ONLY a JSON object",
  "doctrineFingerprint",
  "render_request_id",
  "Finalization note",
  "Voice registers",
  "Provenance",
];

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");

function filesUnder(directory, extension) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(path, extension));
    if (entry.isFile() && entry.name.endsWith(extension)) files.push(path);
  }
  return files;
}

const files = [
  ...filesUnder(resolve(webRoot, "dist", "assets"), ".js"),
  ...filesUnder(resolve(webRoot, "dist", "canon"), ".html"),
];

const leaks = [];
for (const file of files) {
  const content = readFileSync(file, "utf8");
  for (const value of forbidden) {
    if (content.includes(value)) leaks.push({ file: relative(webRoot, file), value });
  }
}

if (leaks.length > 0) {
  for (const leak of leaks) console.error(`public content leak: ${leak.file}: ${JSON.stringify(leak.value)}`);
  process.exitCode = 1;
} else {
  console.log(`public content assertion passed: ${files.length} files scanned`);
}
