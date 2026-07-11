export async function acquireLock(
  db: D1Database, name: string, holder: string, ttlMs: number,
): Promise<boolean> {
  const now = Date.now();
  const r = await db.prepare(
    `INSERT INTO locks (name, holder, expires_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(name) DO UPDATE SET holder = ?2, expires_at = ?3
     WHERE locks.expires_at < ?4`,
  ).bind(name, holder, now + ttlMs, now).run();
  return r.meta.changes === 1;
}

export async function releaseLock(db: D1Database, name: string, holder: string): Promise<void> {
  await db.prepare(`DELETE FROM locks WHERE name = ?1 AND holder = ?2`).bind(name, holder).run();
}
