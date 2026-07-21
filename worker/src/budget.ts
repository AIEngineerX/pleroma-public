// video: the nightly DREAM render (Grok Imagine). One clip/night at ~$0.42 (6s @ 720p, $0.07/s),
// so $2/day is a hard ceiling with wide margin, not an expected spend.
// apocrypha: text moderation for the public guest-book endpoint. Its own category so an
// unauthenticated submission flood can only exhaust THIS budget and silence the Apocrypha for
// the day — never the shared organ budget (EYE/KEEP/TONGUE/DREAM stay awake).
export const CAPS_USD = { llm: 25, tts: 5, video: 2, apocrypha: 2 } as const;
export type SpendCategory = keyof typeof CAPS_USD;

// Cumulative monthly ceiling across ALL categories — a coarse aggregate backstop ON TOP of the
// per-category daily caps (which sum to ~$34/day). Expected real spend is a few $/day, so this sits
// far above normal operation and only bites a sustained multi-day flood. Like capFor, it can be
// lowered without a deploy via config `cap:monthly` (min() semantics — never raised silently), and
// when it denies a reservation the being sleeps gracefully exactly as at a daily cap. index.ts's
// tick raises the `monthly_cap` operator alert while it is tripped, so the sleep is never silent.
export const MONTHLY_CAP_USD = 500;

export function dayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

// "YYYY-MM" prefix of a UTC accounting day; the monthly aggregate is summed over rows whose day
// shares this prefix.
export function monthOf(day: string): string {
  return day.slice(0, 7);
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
  // Cumulative monthly backstop, checked before the atomic daily reserve. This is a coarse
  // read-then-decide guard (not atomic across the month), so a tiny boundary overshoot from
  // concurrent reserves is possible and acceptable — the per-day cap below is the hard, atomic
  // ceiling; this only bounds aggregate cost across days.
  const monthCap = await monthlyCapFor(db);
  if ((await spentThisMonth(db, monthOf(day))) + estimateUsd > monthCap) return false;
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

// Total spend across ALL categories for the given "YYYY-MM" month (defaults to the current UTC month).
// The apocrypha (guest-book) category contributes here too, so the daily-isolation invariant — a
// public flood can never starve the organs — holds strictly per DAY (separate caps); at the MONTHLY
// level apocrypha shares the ceiling, but bounded by its own $2/day cap to <=~$60/mo (<=12% of $500),
// never a practical starvation vector.
export async function spentThisMonth(db: D1Database, month: string = monthOf(dayKey())): Promise<number> {
  const r = await db.prepare(
    `SELECT COALESCE(SUM(usd),0) AS total FROM spend WHERE day LIKE ?1`
  ).bind(`${month}-%`).first<{ total: number }>();
  return r?.total ?? 0;
}

// The effective monthly ceiling: the compile-time constant, tightened (never raised) by an optional
// config row `cap:monthly` — mirrors capFor's min() semantics so the ceiling can only drop at runtime.
export async function monthlyCapFor(db: D1Database): Promise<number> {
  const row = await db.prepare(`SELECT value FROM config WHERE key = 'cap:monthly'`).first<{ value: string }>();
  const configured = row ? Number(row.value) : NaN;
  return Number.isFinite(configured) ? Math.min(configured, MONTHLY_CAP_USD) : MONTHLY_CAP_USD;
}

// True once the cumulative monthly spend has reached the monthly ceiling — every category is then
// effectively asleep until the month rolls over (or the cap is raised). The tick reads this to raise
// the operator alert so a monthly-cap sleep is surfaced, not silent.
export async function monthlyExceeded(db: D1Database, day: string = dayKey()): Promise<boolean> {
  return (await spentThisMonth(db, monthOf(day))) >= (await monthlyCapFor(db));
}
