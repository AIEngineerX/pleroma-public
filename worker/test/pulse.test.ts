import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { classifySwap, aggregate, nextPulseState, currentVitals } from "../src/pulse";
import { applyMigrations } from "./helpers";

beforeAll(() => applyMigrations(env.DB));

const MINT = "MintPleroma1111111111111111111111111111111";
const POOL = "Pool1111111111111111111111111111111111111111";

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

describe("PULSE classification + aggregation", () => {
  it("classifies buys and sells by pool direction", () => {
    expect(classifySwap(buyTx("s1"), MINT, [POOL])).toBe("buy");
    expect(classifySwap(sellTx("s2"), MINT, [POOL])).toBe("sell");
    expect(classifySwap({ ...buyTx("s3"), tokenTransfers: [], events: {} }, MINT, [POOL])).toBeNull();
  });

  it("aggregates classified swaps into per-minute buckets with volume", () => {
    const now = Date.parse("2026-07-12T01:00:30Z");
    const aggs = aggregate([buyTx("a"), buyTx("b"), sellTx("c")], MINT, [POOL], now);
    expect(aggs.length).toBe(1);
    expect(aggs[0].buys).toBe(2);
    expect(aggs[0].sells).toBe(1);
    expect(aggs[0].buy_volume).toBeCloseTo(4); // 2 x 2 SOL
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

  it("rejects a batch larger than the cap", async () => {
    const big = JSON.stringify(Array.from({ length: 501 }, (_, i) => buyTx(`big-${i}`)));
    const res = await SELF.fetch("http://x/api/pulse", {
      method: "POST", headers: { authorization: "test-secret", "content-type": "application/json" }, body: big,
    });
    expect(res.status).toBe(413);
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
