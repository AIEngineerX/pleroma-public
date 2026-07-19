export const WINDOW_MS = 60_000;
export const WALLET_LIMIT = 10; // signed offerings per wallet per minute
export const IP_LIMIT = 20;     // offerings per source IP per minute

// Expired windows are dead weight: one row per (bucket, minute) accrues forever otherwise — an
// unbounded table the nightly backup also re-exports in full every night. Anything older than a
// day is far past every limit window and safe to reap.
export async function sweepRateLimits(db: D1Database, now: number): Promise<void> {
  await db.prepare(`DELETE FROM rate_limits WHERE window_start < ?1`).bind(now - 24 * 60 * 60_000).run();
}

// Fixed-window counter in D1: increments the (bucket, window) row and returns whether the post-increment
// count is within the limit. Atomic via the RETURNING'd count on the upsert, so concurrent posts cannot
// both slip past the boundary.
export async function checkRate(
  db: D1Database, key: string, now: number, windowMs: number, limit: number,
): Promise<boolean> {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const row = await db.prepare(
    `INSERT INTO rate_limits (bucket, window_start, count) VALUES (?1, ?2, 1)
     ON CONFLICT(bucket, window_start) DO UPDATE SET count = count + 1
     RETURNING count`
  ).bind(key, windowStart).first<{ count: number }>();
  return (row?.count ?? limit + 1) <= limit;
}
