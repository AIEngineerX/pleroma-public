const TTL_MS = 300_000;

export async function issueNonce(db: D1Database): Promise<{ nonce: string; expires_at: number }> {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const nonce = [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
  const expires_at = Date.now() + TTL_MS;
  await db.prepare(`INSERT INTO nonces (nonce, expires_at) VALUES (?1, ?2)`).bind(nonce, expires_at).run();
  return { nonce, expires_at };
}

// Validate-only: a real, unexpired, server-issued nonce? Single-use is NOT enforced here — it is
// enforced atomically at insert by offerings' UNIQUE(nonce) index (see offerings.ts), which also makes
// it failure-safe: a nonce is "spent" only by a durably committed offering, so a failed insert (R2 or D1)
// never burns a legitimate token, and a concurrent reuse loses the insert (409).
export async function nonceIsFresh(db: D1Database, nonce: string): Promise<boolean> {
  const row = await db.prepare(`SELECT 1 FROM nonces WHERE nonce = ?1 AND expires_at > ?2`).bind(nonce, Date.now()).first();
  return row !== null;
}
