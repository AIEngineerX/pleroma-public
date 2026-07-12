export const WINDOW_MS = 60_000;
export const WALLET_LIMIT = 10; // signed offerings per wallet per minute
export const IP_LIMIT = 20;     // offerings per source IP per minute

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
