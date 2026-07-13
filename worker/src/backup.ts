import type { Env } from "./env";

// Every persisted table. Migrations own the schema; the backup owns the rows. Update this list when a
// migration adds a table (0006 relics, 0007 rites, 0008 pulse_events, 0009 dreams, 0010 rate_limits).
// 0012 dropped the incremental `vitals` table (vitals now derive from pulse_events).
export const TABLES = [
  "offerings", "transcripts", "wallets", "nonces", "spend", "config",
  "relics", "rites", "pulse_events", "dreams", "rate_limits",
] as const;

export async function exportBackup(env: Env, date: string): Promise<{ key: string; rows: number }> {
  const dump: Record<string, unknown[]> = {};
  let rows = 0;
  for (const t of TABLES) {
    const r = (await env.DB.prepare(`SELECT * FROM ${t}`).all()).results;
    dump[t] = r; rows += r.length;
  }
  const key = `backups/${date}.json`;
  await env.RELICS.put(key, JSON.stringify(dump), { httpMetadata: { contentType: "application/json" } });
  return { key, rows };
}

// Clears and reloads every table from a backup object. Used by the day-6 rehearsal and disaster recovery.
// Order: delete children before parents is unnecessary here (no FKs), so a straight wipe+reload is safe.
export async function restoreBackup(env: Env, key: string): Promise<{ tables: number; rows: number }> {
  const obj = await env.RELICS.get(key);
  if (!obj) throw new Error(`backup ${key} not found`);
  const dump = JSON.parse(await obj.text()) as Record<string, Record<string, unknown>[]>;
  let rows = 0, tables = 0;
  for (const t of TABLES) {
    const data = dump[t] ?? [];
    await env.DB.prepare(`DELETE FROM ${t}`).run();
    tables++;
    for (const row of data) {
      const cols = Object.keys(row);
      if (cols.length === 0) continue;
      const placeholders = cols.map((_, i) => `?${i + 1}`).join(", ");
      await env.DB.prepare(`INSERT INTO ${t} (${cols.join(", ")}) VALUES (${placeholders})`)
        .bind(...cols.map(c => row[c])).run();
      rows++;
    }
  }
  return { tables, rows };
}

export async function sweepBackups(env: Env, now: number, retentionDays = 30): Promise<number> {
  const cutoff = now - retentionDays * 86_400_000;
  let deleted = 0, cursor: string | undefined;
  do {
    const list = await env.RELICS.list({ prefix: "backups/", cursor, limit: 200 });
    for (const o of list.objects) if (o.uploaded.getTime() < cutoff) { await env.RELICS.delete(o.key); deleted++; }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  return deleted;
}
