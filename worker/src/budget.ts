export const CAPS_USD = { llm: 25, tts: 5 } as const;
export type SpendCategory = keyof typeof CAPS_USD;

function dayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function recordSpend(db: D1Database, category: SpendCategory, usd: number): Promise<void> {
  await db.prepare(
    `INSERT INTO spend (day, category, usd) VALUES (?1, ?2, ?3)
     ON CONFLICT(day, category) DO UPDATE SET usd = usd + ?3`
  ).bind(dayKey(), category, usd).run();
}

export async function spentToday(db: D1Database, category: SpendCategory): Promise<number> {
  const row = await db.prepare(`SELECT usd FROM spend WHERE day = ?1 AND category = ?2`)
    .bind(dayKey(), category).first<{ usd: number }>();
  return row?.usd ?? 0;
}

export async function underCap(db: D1Database, category: SpendCategory): Promise<boolean> {
  return (await spentToday(db, category)) < CAPS_USD[category];
}

// Hard pre-call reservation: true if today's spend PLUS this call's conservative cost
// estimate would still fit under the cap. Callers must check this BEFORE making the billed
// call (see mind.ts askMind) so the cap is a hard ceiling, not a check-then-record race that
// a single large call can overshoot.
export async function reserveEstimate(
  db: D1Database, category: SpendCategory, estimateUsd: number,
): Promise<boolean> {
  return (await spentToday(db, category)) + estimateUsd <= CAPS_USD[category];
}

export async function asleep(db: D1Database): Promise<boolean> {
  return !(await underCap(db, "llm"));
}
