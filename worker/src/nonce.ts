const TTL_MS = 300_000;

export async function issueNonce(db: D1Database): Promise<{ nonce: string; expires_at: number }> {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const nonce = [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
  const expires_at = Date.now() + TTL_MS;
  await db.prepare(`INSERT INTO nonces (nonce, expires_at) VALUES (?1, ?2)`).bind(nonce, expires_at).run();
  return { nonce, expires_at };
}

export async function consumeNonce(db: D1Database, nonce: string): Promise<boolean> {
  const r = await db.prepare(
    `UPDATE nonces SET used = 1 WHERE nonce = ?1 AND used = 0 AND expires_at > ?2`
  ).bind(nonce, Date.now()).run();
  return r.meta.changes === 1;
}

// Compensating action for a durable write that failed AFTER the nonce was consumed: return the
// nonce to the unused pool so a transient error does not burn a legitimate one-time token. No-op
// if it has since expired — never re-opens an expired nonce.
export async function releaseNonce(db: D1Database, nonce: string): Promise<void> {
  await db.prepare(
    `UPDATE nonces SET used = 0 WHERE nonce = ?1 AND expires_at > ?2`
  ).bind(nonce, Date.now()).run();
}
