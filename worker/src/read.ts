import type { Env } from "./env";
import { asleep } from "./budget";
import type { RelicRow, TranscriptRow } from "./db";
import { currentVitals } from "./pulse";
import { activeAlerts } from "./alert";

export async function getCodex(env: Env, cursor: string | null): Promise<Response> {
  let curTs: number | null = null, curId: string | null = null;
  if (cursor !== null) {
    // 15 digits caps well under Number.MAX_SAFE_INTEGER (16 digits) so Number() below can never lose
    // precision or overflow to Infinity, which would shift or break pagination.
    const m = /^(\d{1,15}):([0-9A-HJKMNP-TV-Z]{26})$/.exec(cursor);
    if (!m) return Response.json({ error: "bad cursor" }, { status: 400 });
    curTs = Number(m[1]); curId = m[2];
  }
  const rows = (await env.DB.prepare(
    `SELECT * FROM transcripts
     WHERE (?1 IS NULL) OR (created_at < ?1) OR (created_at = ?1 AND id < ?2)
     ORDER BY created_at DESC, id DESC LIMIT 50`
  ).bind(curTs, curId).all<TranscriptRow>()).results;
  const last = rows[rows.length - 1];
  const next = rows.length === 50 ? `${last.created_at}:${last.id}` : null;
  return Response.json({ entries: rows, next });
}

export async function getState(env: Env): Promise<Response> {
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const communicants = await env.DB.prepare(
    `SELECT COUNT(DISTINCT wallet) AS n FROM offerings WHERE wallet IS NOT NULL AND created_at >= ?1`
  ).bind(since.getTime()).first<{ n: number }>();
  const launch = await env.DB.prepare(`SELECT value FROM config WHERE key = 'launch_at'`)
    .first<{ value: string }>();
  const sleeping = await asleep(env.DB);
  const vitals = await currentVitals(env.DB);

  // --- Body contract (Plan 03): mint pin, launch flip, active rite, latest dream ---
  const launched = (await env.DB.prepare(`SELECT value FROM config WHERE key='launched'`).first<{ value: string }>())?.value === "1";
  const mintCfg = (await env.DB.prepare(`SELECT value FROM config WHERE key='pulse_mint'`).first<{ value: string }>())?.value;
  // env.PULSE_MINT is AUTHORITATIVE: it is the same var PULSE (pulse.ts) and the holder poll (holders.ts)
  // read, so the pinned mint the Body shows always equals the mint the vitals are computed from — a stray
  // config row can never override the env mint the Worker actually watches (anti-decoy parity). config
  // 'pulse_mint' is only a fallback for the (production-unused) case where the mint is set via DB rather
  // than the wrangler var; nothing in the Worker writes it, so in production this resolves to env.PULSE_MINT.
  const mintRaw = (env.PULSE_MINT && env.PULSE_MINT.length > 0 ? env.PULSE_MINT : mintCfg) || null;
  // Anti-decoy hardening (belt): the mint is EXPOSED only once launched=1. A pre-set PULSE_MINT or
  // 'pulse_mint' (e.g. to register the Helius webhook) therefore cannot leak the real mint in raw
  // /api/state before the reveal.
  const mint = launched ? mintRaw : null;
  const phase = launched && mint ? "live" : "dormant";

  const today = new Date().toISOString().slice(0, 10);
  const riteRow = await env.DB.prepare(`SELECT date, phase FROM rites WHERE date = ?1`).bind(today).first<{ date: string; phase: string }>();
  const rite = riteRow && riteRow.phase !== "complete" && riteRow.phase !== "failed"
    ? { date: riteRow.date, phase: riteRow.phase } : null;

  const dreamRow = await env.DB.prepare(
    `SELECT narrative, video_key, wakers, created_at FROM dreams ORDER BY created_at DESC LIMIT 1`
  ).first<{ narrative: string; video_key: string | null; wakers: string; created_at: number }>();
  const dream = dreamRow
    ? { narrative: dreamRow.narrative, video_key: dreamRow.video_key, wakers: JSON.parse(dreamRow.wakers) as string[], created_at: dreamRow.created_at }
    : null;

  return Response.json({
    phase,
    mint,
    rite,
    dream,
    asleep: sleeping,
    countdown_to: Number(launch?.value ?? 0) || null,
    communicants_today: communicants?.n ?? 0,
    spend_state: sleeping ? "asleep" : "ok",
    vitals: { state: vitals.state, buys: vitals.buys, sells: vitals.sells, holders: vitals.holders },
    degraded: (await activeAlerts(env.DB)).length > 0,
  });
}

// First Light is a one-time, permanent fact once it happens (the founding mark's genesis relic
// and the dream it seeded never change), so this is a dedicated, unpolled-by-default endpoint
// rather than another field on the 5s-polled /api/state -- no reason to re-query it every tick.
export async function getFirstLight(env: Env): Promise<Response> {
  const relic = await env.DB.prepare(
    `SELECT id, offering_id, wallet, summary, rite_id, kept_at, accreted_at FROM relics WHERE genesis = 1 LIMIT 1`
  ).first<{ id: string; offering_id: string; wallet: string | null; summary: string; rite_id: string | null; kept_at: number; accreted_at: number | null }>();
  if (!relic) return Response.json({ enacted: false, relic: null, dream: null });

  const dreamRow = await env.DB.prepare(
    `SELECT rite_date, narrative, video_key, created_at FROM dreams ORDER BY created_at ASC LIMIT 1`
  ).first<{ rite_date: string; narrative: string; video_key: string | null; created_at: number }>();

  return Response.json({
    enacted: true,
    relic: {
      // id/rite_id/genesis are included alongside the public-facing fields above so the client can
      // replay this relic's own accretion (Stain.tsx's "accrete" BodyCommand needs the full relic
      // shape) -- wallet is deliberately left out; nothing in the replay path reads it.
      id: relic.id, offering_id: relic.offering_id, summary: relic.summary,
      rite_id: relic.rite_id, genesis: 1, kept_at: relic.kept_at, accreted_at: relic.accreted_at,
    },
    dream: dreamRow
      ? { rite_date: dreamRow.rite_date, narrative: dreamRow.narrative, video_key: dreamRow.video_key, created_at: dreamRow.created_at }
      : null,
  });
}

export async function getRelics(env: Env, cursor: string | null): Promise<Response> {
  let curKept: number | null = null, curId: string | null = null;
  if (cursor !== null) {
    // 15 digits caps well under Number.MAX_SAFE_INTEGER (16 digits) so Number() below can never lose
    // precision or overflow to Infinity, which would shift or break pagination.
    const m = /^(\d{1,15}):([0-9A-HJKMNP-TV-Z]{26})$/.exec(cursor);
    if (!m) return Response.json({ error: "bad cursor" }, { status: 400 });
    curKept = Number(m[1]); curId = m[2];
  }
  const rows = (await env.DB.prepare(
    `SELECT * FROM relics WHERE (?1 IS NULL) OR (kept_at < ?1) OR (kept_at = ?1 AND id < ?2)
     ORDER BY kept_at DESC, id DESC LIMIT 50`
  ).bind(curKept, curId).all<RelicRow>()).results;
  const last = rows[rows.length - 1];
  const next = rows.length === 50 ? `${last.kept_at}:${last.id}` : null;
  return Response.json({ entries: rows, next });
}

// The residue lookup (Task 2, grown-lineage-marks): does this offering have a kept relic, and if
// so which one -- the substrate a fresh mark's growth can bend toward is that relic's own image.
// Public columns only (no wallet/summary); offering_id is UNIQUE (see 0006_relics.sql), so this is
// already an indexed point lookup, not a scan.
export async function relicOf(env: Env, offeringId: string): Promise<Response> {
  const relic = await env.DB.prepare(
    `SELECT id, offering_id, kept_at FROM relics WHERE offering_id = ?1`
  ).bind(offeringId).first<{ id: string; offering_id: string; kept_at: number }>();
  return Response.json({ relic: relic ?? null });
}

export async function getDreams(env: Env, cursor: string | null): Promise<Response> {
  let curCreated: number | null = null, curId: string | null = null;
  if (cursor !== null) {
    // Same keyset-cursor contract as getRelics: <created_at>:<ulid>, 15 digits max (< MAX_SAFE_INTEGER).
    const m = /^(\d{1,15}):([0-9A-HJKMNP-TV-Z]{26})$/.exec(cursor);
    if (!m) return Response.json({ error: "bad cursor" }, { status: 400 });
    curCreated = Number(m[1]); curId = m[2];
  }
  const rows = (await env.DB.prepare(
    `SELECT id, rite_date, narrative, video_key, wakers, status, created_at FROM dreams
     WHERE (?1 IS NULL) OR (created_at < ?1) OR (created_at = ?1 AND id < ?2)
     ORDER BY created_at DESC, id DESC LIMIT 50`
  ).bind(curCreated, curId).all<{ id: string; rite_date: string; narrative: string; video_key: string | null; wakers: string; status: string; created_at: number }>()).results;
  const entries = rows.map(r => ({ ...r, wakers: JSON.parse(r.wakers) as string[] }));
  const last = rows[rows.length - 1];
  const next = rows.length === 50 ? `${last.created_at}:${last.id}` : null;
  return Response.json({ entries, next });
}

export async function getTallies(env: Env, date: string): Promise<Response> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Response.json({ error: "bad date" }, { status: 400 });
  const start = Date.parse(date + "T00:00:00.000Z"); const end = start + 86_400_000;
  // The named roll: one tick per wallet whose mark the Eye has WITNESSED today (perceived_at set).
  // Anonymous marks (wallet NULL) are witnessed too but carry no identity to name, so they never
  // appear here — they are counted only in the `marks` total below. Witnessed, not merely offered,
  // so the roll never counts a mark the Eye later refused (rejected marks are never perceived).
  const tallies = (await env.DB.prepare(
    `SELECT o.wallet AS wallet, COUNT(*) AS count, w.tally_name AS name
       FROM offerings o LEFT JOIN wallets w ON w.address = o.wallet
      WHERE o.wallet IS NOT NULL AND o.perceived_at IS NOT NULL
        AND o.created_at >= ?1 AND o.created_at < ?2
      GROUP BY o.wallet ORDER BY count DESC`
  ).bind(start, end).all<{ wallet: string; count: number; name: string | null }>()).results;
  // The honest total: every mark the Eye witnessed today, wallet-bearing OR anonymous. This is what
  // keeps the roll from reading dead when marks are offered without a connected wallet.
  const marks = (await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM offerings
      WHERE perceived_at IS NOT NULL AND created_at >= ?1 AND created_at < ?2`
  ).bind(start, end).first<{ n: number }>())?.n ?? 0;
  return Response.json({ date, marks, communicants: tallies.length, tallies });
}
