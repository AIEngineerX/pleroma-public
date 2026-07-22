// Deploy preflight: refuse to ship code whose migrations have not been applied.
//
// Why this exists: `deploy:prod` is `compile:doctrine && wrangler deploy`, which never touches D1.
// On 2026-07-22 that let a build ship while migration 0025 was still unapplied; the Worker's dispatch
// path queried a column production did not have, threw on its first statement, and posted nothing for
// two hours with no signal. Code ahead of schema is the failure mode; this is the gate for it.
//
// The check is a set difference against D1's own bookkeeping table (`d1_migrations.name`, which stores
// the migration FILENAME), not a scrape of wrangler's human-readable output — that phrasing is not an
// API and would silently start passing if it changed.

import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const WORKER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Migration files present in the repo but absent from the database. Pure, so it is testable. */
export function pendingMigrations(localFiles, appliedNames) {
  const applied = new Set(appliedNames);
  return localFiles.filter((f) => f.endsWith(".sql") && !applied.has(f)).sort();
}

export function localMigrationFiles(dir = join(WORKER_DIR, "migrations")) {
  return readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
}

function appliedMigrationNames(database, env) {
  // Invoke wrangler's JS entry with this Node binary rather than `npx`: on Windows, Node refuses to
  // spawnSync a .cmd shim (EINVAL), and using shell:true instead would put the SQL through cmd.exe
  // quoting. This runs the same code npx would, with no shell in the path.
  const wrangler = join(WORKER_DIR, "node_modules", "wrangler", "bin", "wrangler.js");
  const out = execFileSync(
    process.execPath,
    [wrangler, "d1", "execute", database, "--env", env, "--remote", "--json",
     "--command", "SELECT name FROM d1_migrations"],
    { cwd: WORKER_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  // wrangler prefixes its banner before the JSON payload; take from the first array bracket.
  const start = out.indexOf("[");
  if (start === -1) throw new Error(`could not find JSON in wrangler output:\n${out.slice(0, 500)}`);
  const parsed = JSON.parse(out.slice(start));
  const results = parsed?.[0]?.results;
  if (!Array.isArray(results)) throw new Error("unexpected wrangler JSON shape (no results array)");
  return results.map((r) => r.name);
}

// Only run the network check when invoked directly, so importing the pure helpers in a test is free.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const database = process.argv[2] ?? "pleroma-prod";
  const env = process.argv[3] ?? "production";
  const pending = pendingMigrations(localMigrationFiles(), appliedMigrationNames(database, env));
  if (pending.length > 0) {
    console.error(
      `\nDEPLOY BLOCKED — ${pending.length} migration(s) not applied to '${database}':\n` +
      pending.map((p) => `  - ${p}`).join("\n") +
      `\n\nDeploying now would ship code ahead of its schema. Apply them first:\n` +
      `  npm run migrate:prod\n`,
    );
    process.exit(1);
  }
  console.log(`migrations: up to date on '${database}' (${localMigrationFiles().length} applied)`);
}
