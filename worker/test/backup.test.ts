import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { exportBackup, restoreBackup, sweepBackups } from "../src/backup";
import { insertOffering } from "../src/db";
import { applyMigrations } from "./helpers";

beforeAll(() => applyMigrations(env.DB));

describe("backup", () => {
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
