import { ulid } from "ulid";
import type { Env } from "./env";
import { acquireLock, releaseLock } from "./lock";

const MAX_BATCH = 500;          // H2: Helius batches are small (~<=100); this bounds a single POST's work
const PULSE_LEASE_MS = 30_000;  // M1: lock lease; self-heals if a holder dies
const D1_MAX_PARAMS = 100; // D1 hard limit: <=100 bound parameters per query

export interface HeliusTokenTransfer { fromUserAccount?: string; toUserAccount?: string; mint?: string; tokenAmount?: number }
export interface HeliusNativeTransfer { fromUserAccount?: string; toUserAccount?: string; amount?: number }
export interface HeliusTx {
  signature?: string; timestamp?: number; type?: string; feePayer?: string;
  tokenTransfers?: HeliusTokenTransfer[]; nativeTransfers?: HeliusNativeTransfer[];
  events?: { swap?: { tokenOutputs?: Array<{ mint?: string; userAccount?: string }>;
                      tokenInputs?: Array<{ mint?: string; userAccount?: string }>;
                      nativeInput?: { amount?: string }; nativeOutput?: { amount?: string } } };
}

export type PulseState = "starving" | "calm" | "fed" | "feasting";

// Buy = the token left the pool toward the user (user received our mint). Sell = the token entered the
// pool from the user. Direction is read from the enriched swap event first (authoritative), then from raw
// tokenTransfers relative to the known pool addresses. Returns null if this tx does not move our mint.
export function classifySwap(tx: HeliusTx, mint: string, pools: string[]): "buy" | "sell" | null {
  const poolSet = new Set(pools);
  const swap = tx.events?.swap;
  if (swap) {
    if (swap.tokenOutputs?.some(o => o.mint === mint)) return "buy";
    if (swap.tokenInputs?.some(i => i.mint === mint)) return "sell";
  }
  for (const t of tx.tokenTransfers ?? []) {
    if (t.mint !== mint) continue;
    if (t.fromUserAccount && poolSet.has(t.fromUserAccount)) return "buy";  // token left the pool -> buy
    if (t.toUserAccount && poolSet.has(t.toUserAccount)) return "sell";     // token entered the pool -> sell
  }
  return null;
}

function solInto(tx: HeliusTx, pools: string[]): number {
  const poolSet = new Set(pools);
  let lamports = 0;
  for (const n of tx.nativeTransfers ?? []) if (n.toUserAccount && poolSet.has(n.toUserAccount)) lamports += n.amount ?? 0;
  return lamports / 1e9;
}
function solOutOf(tx: HeliusTx, pools: string[]): number {
  const poolSet = new Set(pools);
  let lamports = 0;
  for (const n of tx.nativeTransfers ?? []) if (n.fromUserAccount && poolSet.has(n.fromUserAccount)) lamports += n.amount ?? 0;
  return lamports / 1e9;
}

export interface MinuteAgg { minute: number; buys: number; sells: number; buy_volume: number; sell_volume: number }

export function aggregate(txs: HeliusTx[], mint: string, pools: string[], nowMs: number): MinuteAgg[] {
  const byMinute = new Map<number, MinuteAgg>();
  for (const tx of txs) {
    const side = classifySwap(tx, mint, pools);
    if (!side) continue;
    const ms = tx.timestamp ? tx.timestamp * 1000 : nowMs;
    const minute = Math.floor(ms / 60_000);
    const a = byMinute.get(minute) ?? { minute, buys: 0, sells: 0, buy_volume: 0, sell_volume: 0 };
    if (side === "buy") { a.buys++; a.buy_volume += solInto(tx, pools); }
    else { a.sells++; a.sell_volume += solOutOf(tx, pools); }
    byMinute.set(minute, a);
  }
  return [...byMinute.values()];
}

// Hysteretic state machine over the 15-minute window's net buy pressure. Each adjacent pair has an UP
// threshold and a DOWN threshold with UP > DOWN; the gap (DOWN, UP] is that boundary's dead-band. You rise
// into a level only when score >= its UP threshold, and fall out of it only when score <= the DOWN
// threshold you would fall back through — so a single tick can never flicker between neighbours.
// Thresholds are indexed by the LOWER level of each boundary:
//   starving<->calm: UP 2  / DOWN 0     calm<->fed: UP 8  / DOWN 4     fed<->feasting: UP 20 / DOWN 14
const LEVELS: PulseState[] = ["starving", "calm", "fed", "feasting"];
const UP = [2, 8, 20];   // starving->calm, calm->fed, fed->feasting
const DOWN = [0, 4, 14]; // calm->starving, fed->calm, feasting->fed
export function nextPulseState(current: PulseState, m: { buys: number; sells: number; netVolume: number }): PulseState {
  const score = m.buys - m.sells + m.netVolume; // net buy pressure
  let i = Math.max(0, LEVELS.indexOf(current)); // -1 (corrupt state row) heals to "starving"
  while (i < LEVELS.length - 1 && score >= UP[i]) i++;   // rise through every UP threshold cleared
  while (i > 0 && score <= DOWN[i - 1]) i--;             // fall through every DOWN threshold breached
  // The two loops are mutually exclusive: UP[k] > DOWN[k] at every boundary, so any score that triggered a
  // rise is strictly above the DOWN line it would fall through, and vice versa. No oscillation.
  return LEVELS[i];
}

async function readState(db: D1Database): Promise<{ state: PulseState; holders: number; updated_at: number }> {
  const row = await db.prepare(`SELECT value FROM config WHERE key = 'pulse_state'`).first<{ value: string }>();
  return row ? JSON.parse(row.value) : { state: "starving", holders: 0, updated_at: 0 };
}
async function writeState(db: D1Database, s: { state: PulseState; holders: number; updated_at: number }): Promise<void> {
  await db.prepare(`INSERT INTO config (key, value) VALUES ('pulse_state', ?1)
     ON CONFLICT(key) DO UPDATE SET value = ?1`).bind(JSON.stringify(s)).run();
}

async function windowMetrics(db: D1Database, nowMs: number): Promise<{ buys: number; sells: number; netVolume: number }> {
  const sinceMinute = Math.floor(nowMs / 60_000) - 15;
  const r = await db.prepare(
    `SELECT COALESCE(SUM(buys),0) AS b, COALESCE(SUM(sells),0) AS s,
            COALESCE(SUM(buy_volume),0) AS bv, COALESCE(SUM(sell_volume),0) AS sv
       FROM vitals WHERE minute >= ?1`
  ).bind(sinceMinute).first<{ b: number; s: number; bv: number; sv: number }>();
  return { buys: r?.b ?? 0, sells: r?.s ?? 0, netVolume: (r?.bv ?? 0) - (r?.sv ?? 0) };
}

export async function currentVitals(db: D1Database): Promise<{ state: PulseState; buys: number; sells: number; holders: number }> {
  const s = await readState(db);
  const m = await windowMetrics(db, Date.now());
  return { state: s.state, buys: m.buys, sells: m.sells, holders: s.holders };
}

export async function handlePulse(env: Env, req: Request): Promise<Response> {
  // Auth: Helius sends the webhook's configured authHeader value as the Authorization header.
  // Plain compare; a remote timing attack through Cloudflare's edge is impractical (network jitter
  // dwarfs the comparison), so this is intentionally NOT a constant-time compare.
  const auth = req.headers.get("authorization") ?? "";
  if (!env.PULSE_WEBHOOK_SECRET || auth !== env.PULSE_WEBHOOK_SECRET) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  let txs: HeliusTx[];
  try { txs = await req.json(); if (!Array.isArray(txs)) throw new Error("expected array"); }
  catch { return Response.json({ error: "bad payload" }, { status: 400 }); }
  // H2: bound the batch so one POST can't trip Worker CPU/subrequest limits (which would also be H1's
  // trigger) or stall the shared D1's write path.
  if (txs.length > MAX_BATCH) {
    return Response.json({ error: "batch too large" }, { status: 413 });
  }

  // M1: serialize ingest + state recompute with the existing lock helper. On contention we return a
  // retryable 503 rather than silently succeed — Helius re-delivers (at-least-once) and dedup makes the
  // retry safe. (Never return 200 without processing: Helius won't retry a 2xx, so that would drop swaps.)
  const holder = ulid();
  if (!(await acquireLock(env.DB, "pulse", holder, PULSE_LEASE_MS))) {
    return Response.json({ error: "busy" }, { status: 503 });
  }
  try {
    const mint = env.PULSE_MINT;
    const pools = env.PULSE_POOLS.split(",").map((s) => s.trim()).filter(Boolean);
    const now = Date.now();

    // De-dup within this batch (first occurrence wins), drop signature-less txs.
    const inBatch = new Set<string>();
    const unique: HeliusTx[] = [];
    for (const tx of txs) {
      if (!tx.signature || inBatch.has(tx.signature)) continue;
      inBatch.add(tx.signature);
      unique.push(tx);
    }

    // Ingest in <=100-signature chunks so each dedup SELECT stays within D1's 100-bound-param limit.
    // Each chunk's mark-seen + count is one atomic batch; a crash between chunks leaves committed chunks
    // fully consistent and the rest unprocessed (Helius re-delivers; already-seen sigs dedup-skip).
    let ingested = 0;
    for (let off = 0; off < unique.length; off += D1_MAX_PARAMS) {
      const chunk = unique.slice(off, off + D1_MAX_PARAMS);
      const placeholders = chunk.map((_, i) => `?${i + 1}`).join(",");
      const existing = await env.DB.prepare(
        `SELECT signature FROM pulse_events WHERE signature IN (${placeholders})`
      ).bind(...chunk.map((t) => t.signature)).all<{ signature: string }>();
      const already = new Set(existing.results.map((r) => r.signature));
      const fresh = chunk.filter((t) => !already.has(t.signature!));
      if (fresh.length === 0) continue;

      const aggs = aggregate(fresh, mint, pools, now);
      const stmts: D1PreparedStatement[] = [];
      for (const tx of fresh) {
        stmts.push(env.DB.prepare(
          `INSERT INTO pulse_events (signature, seen_at) VALUES (?1, ?2) ON CONFLICT(signature) DO NOTHING`
        ).bind(tx.signature, now));
      }
      for (const a of aggs) {
        stmts.push(env.DB.prepare(
          `INSERT INTO vitals (minute, buys, sells, buy_volume, sell_volume) VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT(minute) DO UPDATE SET buys = buys + ?2, sells = sells + ?3,
             buy_volume = buy_volume + ?4, sell_volume = sell_volume + ?5`
        ).bind(a.minute, a.buys, a.sells, a.buy_volume, a.sell_volume));
      }
      await env.DB.batch(stmts);
      ingested += fresh.length;
    }

    const prev = await readState(env.DB);
    const state = nextPulseState(prev.state, await windowMetrics(env.DB, now));
    await writeState(env.DB, { state, holders: prev.holders, updated_at: now });
    return Response.json({ ok: true, ingested, state });
  } finally {
    await releaseLock(env.DB, "pulse", holder);
  }
}
