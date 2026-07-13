import { ulid } from "ulid";
import type { Env } from "./env";
import { acquireLock, releaseLock } from "./lock";

const MAX_BATCH = 500;          // H2: Helius batches are small (~<=100); this bounds a single POST's work
const PULSE_LEASE_MS = 30_000;  // M1: lock lease; self-heals if a holder dies
const INGEST_CHUNK = 100; // statements per D1 batch: bounds one ingest round-trip's work

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

// Wrapped SOL: on a standard AMM (Raydium etc.) the SOL leg of a swap moves as an SPL transfer of this
// mint, not a nativeTransfer. pump.fun bonding-curve trades are native SOL, so both must be accounted for.
const WSOL_MINT = "So11111111111111111111111111111111111111112";

// Buy = the token left the pool toward the user (user received our mint). Sell = the token entered the
// pool from the user. Direction is read from the enriched swap event first (authoritative), then from raw
// tokenTransfers relative to the known pool addresses. Returns null if this tx does not move our mint.
//
// The events.swap branch is gated on touchesPool: Helius's tokenInputs/tokenOutputs carry the TRADER's
// userAccount, not the pool/AMM account, so events.swap alone can't tell which pool a swap went through.
// A tx demonstrably touches our pools only if a pool address appears as a transfer counterparty in
// tokenTransfers/nativeTransfers (confirmed against a live Helius parsed swap) — same signal the fallback
// branch below already uses. Without this gate, a swap of `mint` through ANY pool Helius recognizes would
// count, even ones outside PULSE_POOLS.
export function classifySwap(tx: HeliusTx, mint: string, pools: string[]): "buy" | "sell" | null {
  const poolSet = new Set(pools);
  const touchesPool =
    (tx.tokenTransfers ?? []).some(t => (t.fromUserAccount && poolSet.has(t.fromUserAccount)) || (t.toUserAccount && poolSet.has(t.toUserAccount))) ||
    (tx.nativeTransfers ?? []).some(n => (n.fromUserAccount && poolSet.has(n.fromUserAccount)) || (n.toUserAccount && poolSet.has(n.toUserAccount)));
  const swap = tx.events?.swap;
  if (swap && touchesPool) {
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

// tokenAmount on tokenTransfers is already decimal-adjusted (per Helius's enriched schema), and wSOL has
// 9 decimals same as native SOL, so a wSOL tokenAmount is already in the same SOL unit lamports/1e9 yields
// below — no extra conversion needed, just sum both sources.
function solInto(tx: HeliusTx, pools: string[]): number {
  const poolSet = new Set(pools);
  let lamports = 0;
  for (const n of tx.nativeTransfers ?? []) if (n.toUserAccount && poolSet.has(n.toUserAccount)) lamports += n.amount ?? 0;
  let wsol = 0;
  for (const t of tx.tokenTransfers ?? []) if (t.mint === WSOL_MINT && t.toUserAccount && poolSet.has(t.toUserAccount)) wsol += t.tokenAmount ?? 0;
  return lamports / 1e9 + wsol;
}
function solOutOf(tx: HeliusTx, pools: string[]): number {
  const poolSet = new Set(pools);
  let lamports = 0;
  for (const n of tx.nativeTransfers ?? []) if (n.fromUserAccount && poolSet.has(n.fromUserAccount)) lamports += n.amount ?? 0;
  let wsol = 0;
  for (const t of tx.tokenTransfers ?? []) if (t.mint === WSOL_MINT && t.fromUserAccount && poolSet.has(t.fromUserAccount)) wsol += t.tokenAmount ?? 0;
  return lamports / 1e9 + wsol;
}

// One deduplicated swap's contribution to the vitals aggregate, folded into its pulse_events row so the
// count derives from the (idempotent) dedup log rather than a separate incremental counter. side is null
// for a tx that does not move our mint through our pools — still recorded for dedup, but contributes
// nothing. sol_volume is the SOL into the pool for a buy, out of the pool for a sell.
export interface PulseEvent { signature: string; minute: number; side: "buy" | "sell" | null; sol_volume: number }
export function classifyEvent(tx: HeliusTx, mint: string, pools: string[], nowMs: number): PulseEvent | null {
  if (!tx.signature) return null;
  const side = classifySwap(tx, mint, pools);
  const ms = tx.timestamp ? tx.timestamp * 1000 : nowMs;
  const minute = Math.floor(ms / 60_000);
  const sol_volume = side === "buy" ? solInto(tx, pools) : side === "sell" ? solOutOf(tx, pools) : 0;
  return { signature: tx.signature, minute, side, sol_volume };
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

// Vitals are DERIVED from the deduplicated pulse_events log, never stored incrementally: a signature that
// appears twice (Helius redelivery or a pulse-lock lease overrun) exists as a single row and so is summed
// once. Windowed by the `minute` column (indexed) over the trailing 15 minutes.
async function windowMetrics(db: D1Database, nowMs: number): Promise<{ buys: number; sells: number; netVolume: number }> {
  const sinceMinute = Math.floor(nowMs / 60_000) - 15;
  const r = await db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN side = 'buy'  THEN 1 ELSE 0 END), 0) AS b,
            COALESCE(SUM(CASE WHEN side = 'sell' THEN 1 ELSE 0 END), 0) AS s,
            COALESCE(SUM(CASE WHEN side = 'buy'  THEN sol_volume ELSE 0 END), 0) AS bv,
            COALESCE(SUM(CASE WHEN side = 'sell' THEN sol_volume ELSE 0 END), 0) AS sv
       FROM pulse_events WHERE minute >= ?1`
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

    // Record each swap as one idempotent pulse_events row carrying its classification: the signature is
    // both the dedup key and the idempotency key. ON CONFLICT DO NOTHING means a re-delivered or
    // concurrently-recorded signature (a pulse-lock lease overrun) inserts nothing and so contributes
    // nothing to the DERIVED vitals aggregate — no double count is structurally possible. `ingested`
    // counts only rows this handler actually inserted (meta.changes), i.e. genuinely new signatures.
    // Chunked so each batch stays bounded; a crash between chunks leaves committed chunks fully consistent
    // and the rest unprocessed (Helius re-delivers; already-seen sigs are no-ops next time).
    let ingested = 0;
    for (let off = 0; off < unique.length; off += INGEST_CHUNK) {
      const chunk = unique.slice(off, off + INGEST_CHUNK);
      const stmts = chunk.map((tx) => {
        const ev = classifyEvent(tx, mint, pools, now)!; // `unique` already dropped signature-less txs
        return env.DB.prepare(
          `INSERT INTO pulse_events (signature, seen_at, minute, side, sol_volume) VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT(signature) DO NOTHING`
        ).bind(ev.signature, now, ev.minute, ev.side, ev.sol_volume);
      });
      const results = await env.DB.batch(stmts);
      for (const r of results) ingested += r.meta.changes;
    }

    const prev = await readState(env.DB);
    const state = nextPulseState(prev.state, await windowMetrics(env.DB, now));
    await writeState(env.DB, { state, holders: prev.holders, updated_at: now });
    return Response.json({ ok: true, ingested, state });
  } finally {
    await releaseLock(env.DB, "pulse", holder);
  }
}
