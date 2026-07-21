import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { runTick, runBackupLocked } from "../src/index";
import { applyMigrations } from "./helpers";

beforeAll(() => applyMigrations(env.DB));

async function config(key: string): Promise<string | null> {
  const r = await env.DB.prepare(`SELECT value FROM config WHERE key = ?1`).bind(key).first<{ value: string }>();
  return r?.value ?? null;
}

// The unattended-run signals: a heartbeat that lets an outside monitor detect a silently-dead loop,
// and a backup success marker + failure alert so the one otherwise-signal-less nightly job is visible.
describe("unattended-run durability", () => {
  it("runTick stamps the tick heartbeat, so a stopped loop is detectable from outside the worker", async () => {
    expect(await config("tick_ok")).toBeNull(); // never run yet (isolated storage)
    await runTick(env);
    const at = Number(await config("tick_ok"));
    expect(Number.isFinite(at)).toBe(true);
    expect(Date.now() - at).toBeLessThan(60_000); // stamped ~now
  });

  it("runBackupLocked records a success marker and clears any prior backup_failed alert", async () => {
    // Pretend a previous night's export had failed and left the alert set.
    await env.DB.prepare(`INSERT INTO config (key, value) VALUES ('alert:backup_failed', 'stale') ON CONFLICT(key) DO UPDATE SET value = 'stale'`).run();
    await runBackupLocked(env);
    expect(await config("backup_ok")).not.toBeNull(); // a real export ran to R2
    expect(await config("alert:backup_failed")).toBeNull(); // cleared on success
  });
});
