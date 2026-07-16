import { ulid } from "./id";
import type { Env } from "./env";
import { acquireLock, releaseLock } from "./lock";
import { nextPulseState, readPulseState, windowMetrics, writePulseState } from "./pulse";
import { withTimeout } from "./timeouts";

const PULSE_LOCK_TTL_MS = 30_000; // matches pulse.ts PULSE_LEASE_MS — same "pulse" lock guards config.pulse_state

export interface TokenAccount { owner: string; amount: number }

export function countHolders(pages: TokenAccount[][]): { count: number; owners: Set<string> } {
  const owners = new Set<string>();
  for (const page of pages) for (const a of page) if (a.amount > 0) owners.add(a.owner);
  return { count: owners.size, owners };
}

export interface HeliusHolderPage { error?: unknown; result?: unknown }

// Pure validation of one getTokenAccounts page, extracted so the degraded-response handling is
// unit-testable without a live Helius call (same pattern as parseVerse in eye.ts). Anything that is not a
// well-formed success — a JSON-RPC error body, a missing result, or a result whose token_accounts is not an
// ARRAY (e.g. {}, [], null, a string) — throws: all of these can arrive with HTTP 200, and collapsing them
// to "zero holders" would clear every wallet's attended flag (the destructive-on-degradation failure the
// missing-key guard closes for absent config). ONLY a present token_accounts ARRAY is honored; an EMPTY
// array is a legitimate end-of-data / true-zero page and returns []. A malformed row whose amount is
// non-numeric is dropped by countHolders' `amount > 0` (NaN) rather than miscounted.
export function parseHolderPage(data: HeliusHolderPage): TokenAccount[] {
  const result = data.result;
  const accounts = result && typeof result === "object" && !Array.isArray(result)
    ? (result as { token_accounts?: unknown }).token_accounts
    : undefined;
  if (data.error || !Array.isArray(accounts)) {
    throw new Error(`helius getTokenAccounts error: ${JSON.stringify(data.error ?? "malformed result")}`);
  }
  return (accounts as Array<{ owner: string; amount: number }>).map(a => ({ owner: a.owner, amount: Number(a.amount) }));
}

// Helius DAS getTokenAccounts by mint, paginated. Bounded by maxPages so one tick can't run unbounded;
// at launch-week holder counts (hundreds) a few pages suffice. A dedicated holder service is post-launch.
export async function fetchHolders(env: Env, maxPages = 20): Promise<{ count: number; owners: Set<string> }> {
  // No mint or no API key => nothing to query (DAS needs the key). This also keeps the deterministic
  // test suite hermetic: tests seed a fake PULSE_MINT but no HELIUS_API_KEY, so this early-returns
  // instead of making a real network call to Helius on every keyless tick.
  if (!env.PULSE_MINT || !env.HELIUS_API_KEY) return { count: 0, owners: new Set() };
  const url = `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`;
  const pages: TokenAccount[][] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await withTimeout("helius", 30_000, (signal) => fetch(url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "pleroma-holders", method: "getTokenAccounts",
        params: { mint: env.PULSE_MINT, page, limit: 1000, options: { showZeroBalance: false } } }),
      signal,
    }));
    if (!res.ok) throw new Error(`helius getTokenAccounts ${res.status}`);
    const accounts = parseHolderPage(await res.json<HeliusHolderPage>());
    if (accounts.length === 0) break;
    pages.push(accounts);
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
//
// A Helius/DAS outage must never fail the tick (runTick's caller already wraps this in a best-effort
// try/catch, but this function stays honest on its own): the fetch is wrapped so an outage raises the
// operator alert and leaves holders/attended stale (never zeroed) rather than throwing. A later successful
// refresh clears the alert, so /api/state.degraded reflects current health, not a one-way ratchet.
export async function reconcileHolders(env: Env): Promise<{ holders: number; attendedMarked: number }> {
  // No mint or no Helius key means the holder data source is UNAVAILABLE, not "zero holders". Reconciling
  // from that non-signal would zero the count and clear every wallet's `attended` flag (destructive on
  // degradation). Skip and keep last-good; a later tick with a live key/mint refreshes. This is also the
  // pre-launch steady state (PULSE_MINT empty), where there is nothing to reconcile.
  if (!env.PULSE_MINT || !env.HELIUS_API_KEY) {
    const row = await env.DB.prepare(`SELECT value FROM config WHERE key = 'pulse_state'`).first<{ value: string }>();
    const holders = row ? (JSON.parse(row.value).holders ?? 0) : 0;
    return { holders, attendedMarked: 0 };
  }
  let count: number, owners: Set<string>;
  try {
    ({ count, owners } = await fetchHolders(env));
  } catch (e) {
    const { raiseAlert } = await import("./alert");
    await raiseAlert(env, "pulse_holders_stale", `helius holder refresh failed: ${String(e)}`);
    return { holders: 0, attendedMarked: 0 };
  }
  try { await (await import("./alert")).clearAlert(env, "pulse_holders_stale"); } catch { /* best-effort */ }
  const attendedMarked = await applyAttended(env.DB, owners);

  const holder = ulid();
  if (await acquireLock(env.DB, "pulse", holder, PULSE_LOCK_TTL_MS)) {
    try {
      // Read-modify-write of pulse_state, serialized against handlePulse by the shared "pulse" lock AND
      // guarded by writePulseState's CAS on updated_at: the lock reduces contention, the CAS is the actual
      // safety net (the lease has no fencing token, so a lease overrun could otherwise let this stale write
      // revert a fresher one). This tick ALSO recomputes `state` from the durable pulse_events window, not
      // just the holder count: that makes the reconcile the backstop that recovers any hysteresis transition
      // a webhook computed but dropped on a lost CAS — state converges within a tick without a new webhook.
      // updated_at is forced strictly above the baseline so a same-millisecond version can never repeat.
      const prev = await readPulseState(env.DB);
      const state = nextPulseState(prev.state, await windowMetrics(env.DB, Date.now()));
      const version = Math.max(Date.now(), prev.updated_at + 1);
      await writePulseState(env.DB, { state, holders: count, updated_at: version }, prev.updated_at);
    } finally {
      await releaseLock(env.DB, "pulse", holder);
    }
  }
  return { holders: count, attendedMarked };
}
