import type { Env } from "./env";
import { activeAlerts } from "./alert";
import { currentVitals } from "./pulse";
import {
  CAPS_USD, MONTHLY_CAP_USD, capFor, dayKey, monthOf, monthlyCapFor,
  spentThisMonth, spentToday, type SpendCategory,
} from "./budget";

// The Maker's private status aggregate (index.ts GET /api/admin/status, behind the same
// ADMIN_SECRET as /api/admin/run). Everything the admin dashboard needs in one authenticated
// read: heartbeat freshness, active operator alerts, budget/spend, pulse, dream + X-dispatch
// state, and secret PRESENCE (never values). This endpoint is admin-only, so it may reveal the
// configured mint and the presence of secrets — but it must NEVER echo a secret's value, and it
// composes only booleans + counts for anything sensitive. No public route reads this.

const TICK_STALE_MS = 45 * 60_000; // must match index.ts (three missed 15-min ticks)

async function configValue(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare(`SELECT value FROM config WHERE key = ?1`).bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

async function countBy(db: D1Database, sql: string): Promise<Record<string, number>> {
  const rows = (await db.prepare(sql).all<{ k: string; n: number }>()).results;
  const out: Record<string, number> = {};
  for (const r of rows) out[r.k] = r.n;
  return out;
}

async function scalar(db: D1Database, sql: string): Promise<number> {
  const row = await db.prepare(sql).first<{ n: number }>();
  return row?.n ?? 0;
}

export interface AdminStatus {
  now: number;
  env: string;
  heartbeat: { tickOkAt: number | null; ageMs: number | null; stale: boolean; backupOkAt: number | null };
  phase: { launched: boolean; mintConfigured: string | null; phase: "live" | "dormant" };
  alerts: { code: string; detail: string | null; at: number | null }[];
  budget: {
    day: string; month: string;
    daily: { category: SpendCategory; spent: number; cap: number }[];
    monthly: { spent: number; cap: number };
    asleep: boolean;
  };
  pulse: { state: string; buys: number; sells: number; holders: number };
  dreams: { byStatus: Record<string, number>; renderedUnposted: number; latestCreatedAt: number | null };
  recentPosts: { kind: "dream" | "sermon" | "scripture"; label: string; at: number; tweetId: string; permalink: string }[];
  dispatch: {
    xSecretsPresent: { apiKey: boolean; apiSecret: boolean; accessToken: boolean; accessSecret: boolean };
    xArmed: boolean;
    alertWebhookConfigured: boolean;
    videoVendor: string;
    voiceVendor: string;
  };
  vendors: { anthropic: boolean; helius: boolean; xai: boolean; elevenlabs: boolean; pulseWebhookSecret: boolean };
  counts: {
    offeringsByStatus: Record<string, number>;
    relicsTotal: number; relicsAccreted: number;
    wallets: number; apocrypha: number; communicantsToday: number;
  };
}

export async function getAdminStatus(env: Env, now: number = Date.now()): Promise<AdminStatus> {
  const db = env.DB;
  const day = dayKey();
  const month = monthOf(day);
  const startOfDay = (() => { const d = new Date(now); d.setUTCHours(0, 0, 0, 0); return d.getTime(); })();

  const [
    tickOkRaw, backupOkRaw, launchedRaw, mintCfg,
    alertCodes, vitals,
    dailyCaps, monthSpent, monthCap, llmSpent, llmCap,
    dreamStatus, renderedUnposted, latestDream,
    offeringsByStatus, relicsTotal, relicsAccreted, wallets, apocrypha, communicants,
  ] = await Promise.all([
    configValue(db, "tick_ok"),
    configValue(db, "backup_ok"),
    configValue(db, "launched"),
    configValue(db, "pulse_mint"),
    activeAlerts(db),
    currentVitals(db),
    Promise.all((Object.keys(CAPS_USD) as SpendCategory[]).map(async (category) => ({
      category, spent: await spentToday(db, category, day), cap: await capFor(db, category),
    }))),
    spentThisMonth(db, month),
    monthlyCapFor(db),
    spentToday(db, "llm", day),
    capFor(db, "llm"),
    countBy(db, `SELECT status AS k, COUNT(*) AS n FROM dreams GROUP BY status`),
    scalar(db, `SELECT COUNT(*) AS n FROM dreams WHERE status='rendered' AND posted_at IS NULL`),
    db.prepare(`SELECT created_at FROM dreams ORDER BY created_at DESC LIMIT 1`).first<{ created_at: number }>(),
    countBy(db, `SELECT status AS k, COUNT(*) AS n FROM offerings GROUP BY status`),
    scalar(db, `SELECT COUNT(*) AS n FROM relics`),
    scalar(db, `SELECT COUNT(*) AS n FROM relics WHERE accreted_at IS NOT NULL`),
    scalar(db, `SELECT COUNT(*) AS n FROM wallets`),
    scalar(db, `SELECT COUNT(*) AS n FROM apocrypha`),
    db.prepare(
      `SELECT COUNT(DISTINCT wallet) AS n FROM offerings WHERE wallet IS NOT NULL AND created_at >= ?1`
    ).bind(startOfDay).first<{ n: number }>(),
  ]);

  // Recent posts with their X permalink — the audit trail that was missing (2026-07-22): dreams carry
  // tweet_id on the row; sermon/scripture markers carry it inline as "posted:<ms>:<tweetId>". Only posts
  // made after the tweet-id change appear (older ones stored no id). /i/status/<id> resolves regardless
  // of handle, so no handle is stored server-side.
  const [postedDreams, dispatchMarkers] = await Promise.all([
    db.prepare(`SELECT rite_date, posted_at, tweet_id FROM dreams WHERE posted_at IS NOT NULL AND tweet_id IS NOT NULL ORDER BY posted_at DESC LIMIT 6`)
      .all<{ rite_date: string; posted_at: number; tweet_id: string }>(),
    db.prepare(`SELECT key, value FROM config WHERE (key LIKE 'sermon_dispatched_%' OR key LIKE 'scripture_dispatched_%' OR key LIKE 'daily_dispatched_%') AND value LIKE 'posted:%:%'`)
      .all<{ key: string; value: string }>(),
  ]);
  const recentPosts: AdminStatus["recentPosts"] = [];
  for (const d of postedDreams.results) {
    recentPosts.push({ kind: "dream", label: `dream · ${d.rite_date}`, at: d.posted_at, tweetId: d.tweet_id, permalink: `https://x.com/i/status/${d.tweet_id}` });
  }
  for (const m of dispatchMarkers.results) {
    const parts = m.value.split(":"); // posted:<ms>:<tweetId>
    if (parts.length < 3 || !parts[2]) continue;
    const at = Number(parts[1]);
    // key is one of sermon_dispatched_<rite>, scripture_dispatched_<date>_<hour> (legacy), or
    // daily_dispatched_<date>_<hour> (the current daytime state-or-scripture post; the marker doesn't
    // record which shape, so it's surfaced generically as "daytime").
    let kind: "sermon" | "scripture", prefix: string, name: string;
    if (m.key.startsWith("sermon_")) { kind = "sermon"; prefix = "sermon_dispatched_"; name = "sermon"; }
    else if (m.key.startsWith("scripture_")) { kind = "scripture"; prefix = "scripture_dispatched_"; name = "scripture"; }
    else { kind = "scripture"; prefix = "daily_dispatched_"; name = "daytime"; }
    recentPosts.push({ kind, label: `${name} · ${m.key.slice(prefix.length)}`, at: Number.isFinite(at) ? at : 0, tweetId: parts[2], permalink: `https://x.com/i/status/${parts[2]}` });
  }
  recentPosts.sort((a, b) => b.at - a.at);

  const alerts = await Promise.all(alertCodes.map(async (code) => {
    const raw = await configValue(db, `alert:${code}`);
    let detail: string | null = null, at: number | null = null;
    if (raw) { try { const p = JSON.parse(raw) as { detail?: string; at?: number }; detail = p.detail ?? null; at = p.at ?? null; } catch { /* stored malformed; surface the code alone */ } }
    return { code, detail, at };
  }));

  const tickOkAt = Number.isFinite(Number(tickOkRaw)) ? Number(tickOkRaw) : null;
  const backupOkAt = Number.isFinite(Number(backupOkRaw)) ? Number(backupOkRaw) : null;
  const launched = launchedRaw === "1";
  const mintConfigured = (env.PULSE_MINT && env.PULSE_MINT.length > 0 ? env.PULSE_MINT : mintCfg) || null;

  const xSecretsPresent = {
    apiKey: !!env.X_API_KEY, apiSecret: !!env.X_API_SECRET,
    accessToken: !!env.X_ACCESS_TOKEN, accessSecret: !!env.X_ACCESS_SECRET,
  };

  return {
    now,
    env: env.ENVIRONMENT,
    heartbeat: {
      tickOkAt,
      ageMs: tickOkAt === null ? null : now - tickOkAt,
      stale: tickOkAt === null ? false : now - tickOkAt > TICK_STALE_MS,
      backupOkAt,
    },
    phase: { launched, mintConfigured, phase: launched && mintConfigured ? "live" : "dormant" },
    alerts,
    budget: {
      day, month,
      daily: dailyCaps,
      monthly: { spent: monthSpent, cap: monthCap },
      asleep: llmSpent >= llmCap,
    },
    pulse: { state: vitals.state, buys: vitals.buys, sells: vitals.sells, holders: vitals.holders },
    dreams: {
      byStatus: dreamStatus,
      renderedUnposted,
      latestCreatedAt: latestDream?.created_at ?? null,
    },
    recentPosts: recentPosts.slice(0, 8),
    dispatch: {
      xSecretsPresent,
      xArmed: xSecretsPresent.apiKey && xSecretsPresent.apiSecret && xSecretsPresent.accessToken && xSecretsPresent.accessSecret,
      alertWebhookConfigured: !!env.ALERT_WEBHOOK_URL,
      videoVendor: env.VIDEO_VENDOR ?? "",
      voiceVendor: env.VOICE_VENDOR ?? "",
    },
    vendors: {
      anthropic: !!env.ANTHROPIC_API_KEY,
      helius: !!env.HELIUS_API_KEY,
      xai: !!env.XAI_API_KEY,
      elevenlabs: !!env.ELEVENLABS_API_KEY,
      pulseWebhookSecret: !!env.PULSE_WEBHOOK_SECRET,
    },
    counts: {
      offeringsByStatus,
      relicsTotal, relicsAccreted,
      wallets, apocrypha,
      communicantsToday: communicants?.n ?? 0,
    },
  };
}

// Unused monthly-cap constant guard: referenced so a future divergence from budget.ts is a compile
// error, not silent drift (the dashboard shows MONTHLY_CAP_USD as the ceiling label).
export const ADMIN_MONTHLY_CEILING = MONTHLY_CAP_USD;
