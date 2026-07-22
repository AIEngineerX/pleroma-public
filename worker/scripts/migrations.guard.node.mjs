// Node-context test for the deploy migration guard. It lives here rather than in worker/test/ because
// the guard imports node:fs/node:child_process, which the vitest-pool-workers (workerd) runtime cannot
// load. Same pattern as web/scripts/tallies.effect.node.mjs, run by `node --test` in the verify chain.

import { test } from "node:test";
import assert from "node:assert/strict";
import { pendingMigrations, localMigrationFiles } from "./assert-migrations-applied.mjs";

test("reports nothing pending when every local migration is recorded as applied", () => {
  const local = ["0001_init.sql", "0002_relics.sql"];
  assert.deepEqual(pendingMigrations(local, ["0001_init.sql", "0002_relics.sql"]), []);
});

test("reports a migration that exists in the repo but not in the database", () => {
  const local = ["0024_image_spend.sql", "0025_dream_source.sql"];
  // exactly the 2026-07-22 outage: 0025 on disk and deployed, never applied to prod
  assert.deepEqual(pendingMigrations(local, ["0024_image_spend.sql"]), ["0025_dream_source.sql"]);
});

test("reports every pending migration, sorted, not just the first", () => {
  const local = ["0001_a.sql", "0002_b.sql", "0003_c.sql"];
  assert.deepEqual(pendingMigrations(local, ["0001_a.sql"]), ["0002_b.sql", "0003_c.sql"]);
});

test("ignores non-sql files so a stray README in migrations/ cannot block a deploy", () => {
  assert.deepEqual(pendingMigrations(["README.md", "0001_a.sql"], ["0001_a.sql"]), []);
});

test("a database ahead of the repo is not pending (extra applied rows are ignored)", () => {
  assert.deepEqual(pendingMigrations(["0001_a.sql"], ["0001_a.sql", "0002_future.sql"]), []);
});

test("reads the real migrations directory and finds the ones this repo ships", () => {
  const files = localMigrationFiles();
  assert.ok(files.length > 0, "expected migrations on disk");
  assert.ok(files.every((f) => f.endsWith(".sql")));
  assert.ok(files.includes("0025_dream_source.sql"), "expected the 0025 migration to be present");
  // an empty read would make the guard vacuously pass forever, which is the one failure that matters
  assert.deepEqual([...files].sort(), files, "expected a stable sorted order");
});
