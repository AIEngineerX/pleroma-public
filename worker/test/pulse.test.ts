import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { classifySwap, classifyEvent, nextPulseState, currentVitals } from "../src/pulse";
import { applyMigrations } from "./helpers";

beforeAll(() => applyMigrations(env.DB));

const MINT = "MintPleroma1111111111111111111111111111111";
const POOL = "Pool1111111111111111111111111111111111111111";
const OTHER_POOL = "OtherPool111111111111111111111111111111111"; // recognized by Helius but NOT in PULSE_POOLS
const WSOL_MINT = "So11111111111111111111111111111111111111112";
const WSOL_POOL = "WsolPool1111111111111111111111111111111111";

// A captured Helius enriched-transaction SHAPE (the fields PULSE reads). A user buying the token:
// SOL leaves the user (nativeTransfers to the pool), the token reaches the user (tokenTransfers to feePayer).
function buyTx(sig: string): any {
  return {
    signature: sig, timestamp: Math.floor(Date.now() / 1000), type: "SWAP", feePayer: "UserBuyer111",
    tokenTransfers: [{ fromUserAccount: POOL, toUserAccount: "UserBuyer111", mint: MINT, tokenAmount: 1000 }],
    nativeTransfers: [{ fromUserAccount: "UserBuyer111", toUserAccount: POOL, amount: 2_000_000_000 }],
    events: { swap: { tokenOutputs: [{ mint: MINT, userAccount: "UserBuyer111" }], nativeInput: { amount: "2000000000" } } },
  };
}
function sellTx(sig: string): any {
  return {
    signature: sig, timestamp: Math.floor(Date.now() / 1000), type: "SWAP", feePayer: "UserSeller111",
    tokenTransfers: [{ fromUserAccount: "UserSeller111", toUserAccount: POOL, mint: MINT, tokenAmount: 1000 }],
    nativeTransfers: [{ fromUserAccount: POOL, toUserAccount: "UserSeller111", amount: 1_000_000_000 }],
    events: { swap: { tokenInputs: [{ mint: MINT, userAccount: "UserSeller111" }], nativeOutput: { amount: "1000000000" } } },
  };
}

// Same shape as buyTx, but through OTHER_POOL — a pool Helius recognizes that is NOT in PULSE_POOLS.
// events.swap alone (tokenOutputs carrying the mint) is not pool-specific; the regression this guards
// against is classifySwap counting this as a buy anyway.
function buyTxOtherPool(sig: string): any {
  return {
    signature: sig, timestamp: Math.floor(Date.now() / 1000), type: "SWAP", feePayer: "UserBuyer222",
    tokenTransfers: [{ fromUserAccount: OTHER_POOL, toUserAccount: "UserBuyer222", mint: MINT, tokenAmount: 1000 }],
    nativeTransfers: [{ fromUserAccount: "UserBuyer222", toUserAccount: OTHER_POOL, amount: 2_000_000_000 }],
    events: { swap: { tokenOutputs: [{ mint: MINT, userAccount: "UserBuyer222" }], nativeInput: { amount: "2000000000" } } },
  };
}

// A wSOL-denominated AMM pool: the SOL leg moves as an SPL transfer of WSOL_MINT to/from the pool
// (nativeTransfers empty, as on a real Raydium-style swap), not a nativeTransfer.
function wsolBuyTx(sig: string): any {
  return {
    signature: sig, timestamp: Math.floor(Date.now() / 1000), type: "SWAP", feePayer: "UserWsolBuyer1",
    tokenTransfers: [
      { fromUserAccount: WSOL_POOL, toUserAccount: "UserWsolBuyer1", mint: MINT, tokenAmount: 500 },
      { fromUserAccount: "UserWsolBuyer1", toUserAccount: WSOL_POOL, mint: WSOL_MINT, tokenAmount: 1.5 },
    ],
    nativeTransfers: [],
    events: { swap: { tokenOutputs: [{ mint: MINT, userAccount: "UserWsolBuyer1" }] } },
  };
}
function wsolSellTx(sig: string): any {
  return {
    signature: sig, timestamp: Math.floor(Date.now() / 1000), type: "SWAP", feePayer: "UserWsolSeller1",
    tokenTransfers: [
      { fromUserAccount: "UserWsolSeller1", toUserAccount: WSOL_POOL, mint: MINT, tokenAmount: 500 },
      { fromUserAccount: WSOL_POOL, toUserAccount: "UserWsolSeller1", mint: WSOL_MINT, tokenAmount: 1.2 },
    ],
    nativeTransfers: [],
    events: { swap: { tokenInputs: [{ mint: MINT, userAccount: "UserWsolSeller1" }] } },
  };
}

describe("PULSE classification + aggregation", () => {
  it("classifies buys and sells by pool direction", () => {
    expect(classifySwap(buyTx("s1"), MINT, [POOL])).toBe("buy");
    expect(classifySwap(sellTx("s2"), MINT, [POOL])).toBe("sell");
    expect(classifySwap({ ...buyTx("s3"), tokenTransfers: [], events: {} }, MINT, [POOL])).toBeNull();
  });

  // Regression guard: the events.swap branch must not classify a swap that never touches PULSE_POOLS,
  // even though events.swap's tokenOutputs alone (no pool identity) says it moved our mint.
  it("does not classify a swap of the mint through a pool outside PULSE_POOLS", () => {
    expect(classifySwap(buyTxOtherPool("s4"), MINT, [POOL])).toBeNull();
    expect(classifySwap(buyTxOtherPool("s5"), MINT, [])).toBeNull(); // empty PULSE_POOLS attributes nothing
  });

  it("classifies wSOL-pool swaps by direction (pool-gated same as native-SOL pools)", () => {
    expect(classifySwap(wsolBuyTx("s6"), MINT, [WSOL_POOL])).toBe("buy");
    expect(classifySwap(wsolSellTx("s7"), MINT, [WSOL_POOL])).toBe("sell");
  });

  it("classifies each swap into a minute bucket with side and pool-directed volume", () => {
    const now = Date.parse("2026-07-12T01:00:30Z");
    const minute = Math.floor(Date.parse("2026-07-12T01:00:30Z") / 60_000);
    const buy = classifyEvent({ ...buyTx("a"), timestamp: now / 1000 }, MINT, [POOL], now);
    const sell = classifyEvent({ ...sellTx("c"), timestamp: now / 1000 }, MINT, [POOL], now);
    expect(buy).toMatchObject({ side: "buy", minute });
    expect(buy?.sol_volume).toBeCloseTo(2); // 2 SOL into the pool
    expect(sell).toMatchObject({ side: "sell", minute });
    expect(sell?.sol_volume).toBeCloseTo(1);
    // A tx that never touches our pools classifies with side=null (recorded for dedup, contributes nothing).
    const none = classifyEvent(buyTxOtherPool("z"), MINT, [POOL], now);
    expect(none?.side).toBeNull();
    expect(none?.sol_volume).toBe(0);
  });

  it("counts wSOL SPL-transfer volume for a wSOL-denominated pool (nativeTransfers empty)", () => {
    const now = Date.parse("2026-07-12T01:00:30Z");
    const buy = classifyEvent({ ...wsolBuyTx("w1"), timestamp: now / 1000 }, MINT, [WSOL_POOL], now);
    const sell = classifyEvent({ ...wsolSellTx("w2"), timestamp: now / 1000 }, MINT, [WSOL_POOL], now);
    expect(buy?.side).toBe("buy");
    expect(buy?.sol_volume).toBeCloseTo(1.5);
    expect(sell?.side).toBe("sell");
    expect(sell?.sol_volume).toBeCloseTo(1.2);
  });
});

describe("PULSE hysteresis (per-boundary dead-band, no flicker)", () => {
  // score = buys - sells + netVolume. UP = [2,8,20], DOWN = [0,4,14] indexed by the lower level.
  it("rises only when score clears the UP threshold, cascading through cleared levels", () => {
    expect(nextPulseState("starving", { buys: 30, sells: 2, netVolume: 20 })).toBe("feasting"); // score 48 >= 2,8,20
    expect(nextPulseState("starving", { buys: 3, sells: 1, netVolume: 0 })).toBe("calm");        // score 2 == UP[0], < UP[1]
    expect(nextPulseState("starving", { buys: 1, sells: 1, netVolume: 0 })).toBe("starving");     // score 0 < UP[0]
  });

  it("holds inside the dead-band: a score too low to have risen in, but still above the fall line", () => {
    // feasting's dead-band is (14, 20]: at score 16 you would NOT rise into feasting, but you do NOT fall out.
    expect(nextPulseState("feasting", { buys: 10, sells: 0, netVolume: 6 })).toBe("feasting"); // score 16
    // fed's dead-band is (4, 8]: score 6 holds fed.
    expect(nextPulseState("fed", { buys: 6, sells: 0, netVolume: 0 })).toBe("fed");            // score 6
  });

  it("falls only when score drops to or below the DOWN threshold, cascading down", () => {
    expect(nextPulseState("feasting", { buys: 1, sells: 9, netVolume: -8 })).toBe("starving"); // score -16 <= 14,4,0
    expect(nextPulseState("feasting", { buys: 8, sells: 0, netVolume: 2 })).toBe("fed");         // score 10 <= 14, > 4 -> fed
    expect(nextPulseState("calm", { buys: 0, sells: 0, netVolume: 0 })).toBe("starving");        // score 0 <= DOWN[0]=0
  });
});

describe("POST /api/pulse", () => {
  it("rejects an unauthenticated webhook", async () => {
    const res = await SELF.fetch("http://x/api/pulse", { method: "POST", body: "[]" });
    expect(res.status).toBe(401);
  });

  it("ingests, dedups by signature, and updates vitals", async () => {
    const body = JSON.stringify([buyTx("dedup-sig"), buyTx("dedup-sig"), sellTx("sell-sig")]);
    const headers = { authorization: "test-secret", "content-type": "application/json" };
    const res = await SELF.fetch("http://x/api/pulse", { method: "POST", headers, body });
    expect(res.status).toBe(200);
    // re-deliver the same batch: dedup means no double counting
    await SELF.fetch("http://x/api/pulse", { method: "POST", headers, body });
    const v = await currentVitals(env.DB);
    expect(v.buys).toBe(1); // dedup-sig counted once despite three deliveries of it
    expect(v.sells).toBe(1);
  });

  it("counts a signature once even if a lease overrun makes two handlers record it (idempotent vitals)", async () => {
    // The bug: under a pulse-lock lease overrun two handlers process the SAME signature; the old code's
    // pulse_events insert deduped (ON CONFLICT DO NOTHING) but its `vitals buys = buys + delta` increment
    // was unconditional, so the second handler double-counted the swap. Vitals now DERIVE from the
    // deduplicated pulse_events log, so recording the same signature twice contributes exactly once.
    const now = Date.now();
    const minute = Math.floor(now / 60_000);
    const record = () => env.DB.prepare(
      `INSERT INTO pulse_events (signature, seen_at, minute, side, sol_volume) VALUES ('overrun-sig', ?1, ?2, 'buy', 2)
       ON CONFLICT(signature) DO NOTHING`
    ).bind(now, minute).run();
    await record();
    await record(); // the concurrent/overrun second write the old code would have double-counted
    const v = await currentVitals(env.DB);
    expect(v.buys).toBe(1);
    const vol = await env.DB.prepare(
      `SELECT COALESCE(SUM(sol_volume),0) AS bv FROM pulse_events WHERE side='buy' AND minute=?1`
    ).bind(minute).first<{ bv: number }>();
    expect(vol?.bv).toBeCloseTo(2); // volume counted once, not doubled
  });

  it("pulse_state CAS: a stalled writer on an old baseline cannot revert a committed newer write", async () => {
    // Both actors read the same pulse_state baseline. Actor B (holder-reconcile) commits holders=12.
    // Actor A (a webhook handler that stalled past the pulse-lease) then resumes and tries to write its
    // stale holders=10. Without the CAS, A's write reverts the public holder count; with it, A loses.
    const { readPulseState, writePulseState } = await import("../src/pulse");
    const base = await readPulseState(env.DB); // seeded { starving, 0, updated_at: 0 }
    const bWon = await writePulseState(env.DB,
      { state: base.state, holders: 12, updated_at: base.updated_at + 100 }, base.updated_at);
    expect(bWon).toBe(true);
    const aWon = await writePulseState(env.DB,
      { state: base.state, holders: 10, updated_at: base.updated_at + 50 }, base.updated_at); // stale baseline
    expect(aWon).toBe(false);
    const after = await readPulseState(env.DB);
    expect(after.holders).toBe(12); // B's fresher count preserved, not reverted to 10
  });

  it("rejects a batch larger than the cap", async () => {
    const big = JSON.stringify(Array.from({ length: 501 }, (_, i) => buyTx(`big-${i}`)));
    const res = await SELF.fetch("http://x/api/pulse", {
      method: "POST", headers: { authorization: "test-secret", "content-type": "application/json" }, body: big,
    });
    expect(res.status).toBe(413);
  });

  it("ingests a batch that spans multiple D1 param-limit chunks (>100 unique sigs)", async () => {
    const txs = Array.from({ length: 150 }, (_, i) => buyTx(`multi-chunk-${i}`));
    const res = await SELF.fetch("http://x/api/pulse", {
      method: "POST",
      headers: { authorization: "test-secret", "content-type": "application/json" },
      body: JSON.stringify(txs),
    });
    expect(res.status).toBe(200);
    const v = await currentVitals(env.DB);
    expect(v.buys).toBe(150); // all 150 counted across the 100 + 50 chunk split; none dropped by the param limit
  });

  // Placed after the ingest test above so a held lock can't make an earlier test's POST 503 unexpectedly.
  it("returns 503 when another ingest holds the pulse lock (Helius will retry)", async () => {
    const { acquireLock, releaseLock } = await import("../src/lock");
    const ok = await acquireLock(env.DB, "pulse", "someone-else", 60_000);
    expect(ok).toBe(true);
    try {
      const res = await SELF.fetch("http://x/api/pulse", {
        method: "POST",
        headers: { authorization: "test-secret", "content-type": "application/json" },
        body: JSON.stringify([buyTx("locked-out")]),
      });
      expect(res.status).toBe(503);
    } finally {
      await releaseLock(env.DB, "pulse", "someone-else"); // release so later tests can acquire it
    }
  });
});
