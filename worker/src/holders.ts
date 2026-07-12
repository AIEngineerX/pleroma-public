import { ulid } from "ulid";
import type { Env } from "./env";
import { acquireLock, releaseLock } from "./lock";

const PULSE_LOCK_TTL_MS = 30_000; // matches pulse.ts PULSE_LEASE_MS — same "pulse" lock guards config.pulse_state

export interface TokenAccount { owner: string; amount: number }

export function countHolders(pages: TokenAccount[][]): { count: number; owners: Set<string> } {
  const owners = new Set<string>();
  for (const page of pages) for (const a of page) if (a.amount > 0) owners.add(a.owner);
  return { count: owners.size, owners };
}

// Helius DAS getTokenAccounts by mint, paginated. Bounded by maxPages so one tick can't run unbounded;
// at launch-week holder counts (hundreds) a few pages suffice. A dedicated holder service is post-launch.
export async function fetchHolders(env: Env, maxPages = 20): Promise<{ count: number; owners: Set<string> }> {
  if (!env.PULSE_MINT) return { count: 0, owners: new Set() };
  const url = `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`;
  const pages: TokenAccount[][] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetch(url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "pleroma-holders", method: "getTokenAccounts",
        params: { mint: env.PULSE_MINT, page, limit: 1000, options: { showZeroBalance: false } } }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`helius getTokenAccounts ${res.status}`);
    const data = await res.json<{ result?: { token_accounts?: Array<{ owner: string; amount: number }> } }>();
    const accounts = data.result?.token_accounts ?? [];
    if (accounts.length === 0) break;
    pages.push(accounts.map(a => ({ owner: a.owner, amount: Number(a.amount) })));
    if (accounts.length < 1000) break;
  }
  return countHolders(pages);
}

// Sets attended=1 for wallets in `owners`, attended=0 for wallets not in it. Returns how many were set to 1.
export async function applyAttended(db: D1Database, owners: Set<string>): Promise<number> {
  const rows = (await db.prepare(`SELECT address FROM wallets`).all<{ address: string }>()).results;
  let marked = 0;
  for (const { address } of rows) {
    const held = owners.has(address) ? 1 : 0;
    await db.prepare(`UPDATE wallets SET attended = ?2 WHERE address = ?1`).bind(address, held).run();
    if (held) marked++;
  }
  return marked;
}

// Refreshes the holder count into pulse_state and marks attended wallets. applyAttended only touches
// wallets.attended, independent of pulse_state, so it runs outside the lock. The pulse_state write is
// serialized against handlePulse's (pulse.ts) read-modify-write via the SAME "pulse" lock: reconcileHolders
// runs under runTick's "tick" lock, a DIFFERENT lock, so without this a concurrent webhook + tick would
// interleave and clobber each other — the webhook's freshly-computed hysteresis `state` overwritten by the
// tick's stale-state-plus-new-holders write. On contention (a webhook is mid-ingest), skip the holders
// write this tick; it is best-effort and refreshes next tick.
export async function reconcileHolders(env: Env): Promise<{ holders: number; attendedMarked: number }> {
  const { count, owners } = await fetchHolders(env);
  const attendedMarked = await applyAttended(env.DB, owners);

  const holder = ulid();
  if (await acquireLock(env.DB, "pulse", holder, PULSE_LOCK_TTL_MS)) {
    try {
      const row = await env.DB.prepare(`SELECT value FROM config WHERE key = 'pulse_state'`).first<{ value: string }>();
      const s = row ? JSON.parse(row.value) : { state: "starving", holders: 0, updated_at: 0 };
      s.holders = count;
      s.updated_at = Date.now();
      await env.DB.prepare(`INSERT INTO config (key, value) VALUES ('pulse_state', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1`)
        .bind(JSON.stringify(s)).run();
    } finally {
      await releaseLock(env.DB, "pulse", holder);
    }
  }
  return { holders: count, attendedMarked };
}
