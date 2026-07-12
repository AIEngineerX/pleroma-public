import type { Env } from "./env";

export interface HeliusTokenTransfer { fromUserAccount?: string; toUserAccount?: string; mint?: string; tokenAmount?: number }
export interface HeliusNativeTransfer { fromUserAccount?: string; toUserAccount?: string; amount?: number }
export interface HeliusTx {
  signature: string; timestamp?: number; type?: string; feePayer?: string;
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
  let i = LEVELS.indexOf(current);
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
  // Webhook auth: Helius sends the exact string configured as the webhook's authHeader as the
  // Authorization header on every POST. Constant-time-ish equality against the shared secret.
  const auth = req.headers.get("authorization") ?? "";
  if (!env.PULSE_WEBHOOK_SECRET || auth !== env.PULSE_WEBHOOK_SECRET) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  let txs: HeliusTx[];
  try { txs = await req.json(); if (!Array.isArray(txs)) throw new Error("expected array"); }
  catch { return Response.json({ error: "bad payload" }, { status: 400 }); }

  const mint = env.PULSE_MINT, pools = env.PULSE_POOLS.split(",").map(s => s.trim()).filter(Boolean);
  const now = Date.now();
  // Dedup: insert each signature; a duplicate (already delivered) is skipped from aggregation.
  const fresh: HeliusTx[] = [];
  for (const tx of txs) {
    if (!tx.signature) continue;
    const r = await env.DB.prepare(`INSERT INTO pulse_events (signature, seen_at) VALUES (?1, ?2) ON CONFLICT(signature) DO NOTHING`)
      .bind(tx.signature, now).run();
    if (r.meta.changes === 1) fresh.push(tx);
  }
  for (const a of aggregate(fresh, mint, pools, now)) {
    await env.DB.prepare(
      `INSERT INTO vitals (minute, buys, sells, buy_volume, sell_volume) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(minute) DO UPDATE SET buys = buys + ?2, sells = sells + ?3,
         buy_volume = buy_volume + ?4, sell_volume = sell_volume + ?5`
    ).bind(a.minute, a.buys, a.sells, a.buy_volume, a.sell_volume).run();
  }
  const prev = await readState(env.DB);
  const state = nextPulseState(prev.state, await windowMetrics(env.DB, now));
  await writeState(env.DB, { state, holders: prev.holders, updated_at: now });
  return Response.json({ ok: true, ingested: fresh.length, state });
}
