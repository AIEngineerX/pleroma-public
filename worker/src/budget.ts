export const CAPS_USD = { llm: 25, tts: 5 } as const;
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
  return (await spentToday(db, category)) < CAPS_USD[category];
}

// Atomically reserve `estimateUsd` against today's cap. The increment and the cap check are
// ONE statement, so two callers cannot both pass at the boundary. Returns true iff the
// reservation was applied (spend was incremented). Callers MUST settle the reservation after
// the billed call resolves (see mind.ts): recordSpend(db, cat, actualUsd - estimateUsd) on a
// known cost, or recordSpend(db, cat, -estimateUsd) to release it if the call never billed.
export async function reserveEstimate(
  db: D1Database, category: SpendCategory, estimateUsd: number, day: string = dayKey(),
): Promise<boolean> {
  if (estimateUsd > CAPS_USD[category]) return false;
  const row = await db.prepare(
    `INSERT INTO spend (day, category, usd) VALUES (?1, ?2, ?3)
     ON CONFLICT(day, category) DO UPDATE SET usd = usd + excluded.usd
       WHERE spend.usd + excluded.usd <= ?4
     RETURNING usd`
  ).bind(day, category, estimateUsd, CAPS_USD[category]).first<{ usd: number }>();
  return row !== null;
}

export async function asleep(db: D1Database): Promise<boolean> {
  return !(await underCap(db, "llm"));
}
