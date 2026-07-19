import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { EPHEMERAL_TABLES, exportBackup, restoreBackup, sweepBackups, TABLES } from "../src/backup";
import { insertOffering } from "../src/db";
import { applyMigrations } from "./helpers";

beforeAll(() => applyMigrations(env.DB));

describe("backup", () => {
  it("TABLES covers every real table in the schema — a migration can never silently skip the backup", async () => {
    const real = (await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'`
    ).all<{ name: string }>()).results.map(r => r.name);
    const covered: readonly string[] = [...TABLES, ...EPHEMERAL_TABLES];
    for (const t of real) {
      expect(covered, `table "${t}" is in neither backup.ts TABLES nor EPHEMERAL_TABLES`).toContain(t);
    }
  });

  it("round-trips apocrypha verses — Waker writing survives disaster recovery", async () => {
    await env.DB.prepare(`INSERT INTO apocrypha (id, text, created_at) VALUES ('apo-bk1', 'a verse', ?1)`)
      .bind(Date.now()).run();
    const { key } = await exportBackup(env, "2026-07-13");
    await (await env.RELICS.get(key))?.arrayBuffer(); // consume the body (storage teardown)
    await env.DB.prepare(`DELETE FROM apocrypha`).run();
    await restoreBackup(env, key);
    const back = await env.DB.prepare(`SELECT text FROM apocrypha WHERE id = 'apo-bk1'`).first<{ text: string }>();
    expect(back?.text).toBe("a verse");
  });

  it("exports every table and restores it after a wipe (round-trip)", async () => {
    await insertOffering(env.DB, { id: "bk1", wallet: "wBk", sig: null, image_key: "offerings/bk1",
      sha256: "bk1", status: "perceived", attempts: 0, created_at: Date.now(), perceived_at: Date.now() });
    const { key, rows } = await exportBackup(env, "2026-07-12");
    expect(rows).toBeGreaterThanOrEqual(1);
    const stored = await env.RELICS.get(key);
    expect(stored).not.toBeNull();
    await stored?.arrayBuffer(); // consume the body: unread R2ObjectBody streams break storage teardown

    // wipe offerings, then restore from the backup
    await env.DB.prepare(`DELETE FROM offerings`).run();
    expect(await env.DB.prepare(`SELECT COUNT(*) AS n FROM offerings`).first<{ n: number }>()).toMatchObject({ n: 0 });
    const res = await restoreBackup(env, key);
    expect(res.rows).toBeGreaterThanOrEqual(1);
    const back = await env.DB.prepare(`SELECT id FROM offerings WHERE id = 'bk1'`).first<{ id: string }>();
    expect(back?.id).toBe("bk1");
  });

  it("deletes backups older than the retention window", async () => {
    await env.RELICS.put("backups/2026-05-01.json", new Uint8Array([1]));
    const future = Date.now() + 40 * 86_400_000; // 40 days later
    const deleted = await sweepBackups(env, future, 30);
    expect(deleted).toBeGreaterThanOrEqual(1);
  });
});
