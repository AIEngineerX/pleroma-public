// video: the nightly DREAM render (Grok Imagine). One clip/night at ~$0.42 (6s @ 720p, $0.07/s),
// so $2/day is a hard ceiling with wide margin, not an expected spend.
export const CAPS_USD = { llm: 25, tts: 5, video: 2 } as const;
export type SpendCategory = keyof typeof CAPS_USD;

export function dayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

// `day` defaults to "today" but a caller that must pin ONE accounting day across a
// reserve->settle pair (see mind.ts askMind) passes it explicitly, so a tick that straddles
// UTC midnight always reserves and settles against the same day's row.
export async function recordSpend(
  db: D1Database, category: SpendCategory, usd: number, day: string = dayKey(),
): Promise<void> {
  await db.prepare(
    `INSERT INTO spend (day, category, usd) VALUES (?1, ?2, ?3)
     ON CONFLICT(day, category) DO UPDATE SET usd = usd + ?3`
  ).bind(day, category, usd).run();
}

export async function spentToday(
  db: D1Database, category: SpendCategory, day: string = dayKey(),
): Promise<number> {
  const row = await db.prepare(`SELECT usd FROM spend WHERE day = ?1 AND category = ?2`)
    .bind(day, category).first<{ usd: number }>();
  return row?.usd ?? 0;
}

export async function underCap(db: D1Database, category: SpendCategory): Promise<boolean> {
  return (await spentToday(db, category)) < (await capFor(db, category));
}

// Atomically reserve `estimateUsd` against today's cap. The increment and the cap check are
// ONE statement, so two callers cannot both pass at the boundary. Returns true iff the
// reservation was applied (spend was incremented). Callers MUST settle the reservation after
// the billed call resolves (see mind.ts): recordSpend(db, cat, actualUsd - estimateUsd) on a
// known cost, or recordSpend(db, cat, -estimateUsd) to release it if the call never billed.
export async function reserveEstimate(
  db: D1Database, category: SpendCategory, estimateUsd: number, day: string = dayKey(),
): Promise<boolean> {
  const cap = await capFor(db, category);
  if (estimateUsd > cap) return false;
  const row = await db.prepare(
    `INSERT INTO spend (day, category, usd) VALUES (?1, ?2, ?3)
     ON CONFLICT(day, category) DO UPDATE SET usd = usd + excluded.usd
       WHERE spend.usd + excluded.usd <= ?4
     RETURNING usd`
  ).bind(day, category, estimateUsd, cap).first<{ usd: number }>();
  return row !== null;
}

export async function asleep(db: D1Database): Promise<boolean> {
  return !(await underCap(db, "llm"));
}

// The priest's cap can be lowered without a deploy (a Concordat-disclosed change, reviewed at the 14-day
// checkpoint): a config row `cap:<category>` overrides the compile-time constant. Never RAISED silently —
// a value above the constant is ignored so the hard ceiling can only tighten at runtime.
export async function capFor(db: D1Database, category: SpendCategory): Promise<number> {
  const row = await db.prepare(`SELECT value FROM config WHERE key = ?1`).bind(`cap:${category}`).first<{ value: string }>();
  const configured = row ? Number(row.value) : NaN;
  return Number.isFinite(configured) ? Math.min(configured, CAPS_USD[category]) : CAPS_USD[category];
}

// Mean daily spend over the trailing 7 UTC days (today inclusive). Feeds the 14-day checkpoint review:
// if this tracks the ceiling without matching communicant growth, caps are lowered via cap:<category>.
export async function trailing7DayAvg(db: D1Database, category: SpendCategory, today: string): Promise<number> {
  const start = new Date(Date.parse(today + "T00:00:00Z") - 6 * 86_400_000).toISOString().slice(0, 10);
  const r = await db.prepare(
    `SELECT COALESCE(SUM(usd),0) AS total FROM spend WHERE category = ?1 AND day >= ?2 AND day <= ?3`
  ).bind(category, start, today).first<{ total: number }>();
  return (r?.total ?? 0) / 7;
}
