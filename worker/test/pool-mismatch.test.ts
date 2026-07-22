import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers";
import { handlePulse, alertPoolMismatch } from "../src/pulse";

beforeAll(() => applyMigrations(env.DB));

// The graduation failure mode this guards: the Helius webhook keeps delivering swaps of our mint
// (it watches the MINT, venue-independent), but every trade now routes through a pool that is not
// in PULSE_POOLS — so every delivery records a side=NULL dedup row and the vitals flatline while
// the token is at peak activity. The tripwire is deliveries-without-classification, not silence:
// a genuinely quiet market produces no rows at all and must never alert.
//
// One sequential `it` (launch-flip.test.ts pattern): isolatedStorage rolls the DB back per test,
// so the pile-up → raise → clear progression must live in a single test body.
const MINT = "MintPleroma1111111111111111111111111111111";
const POOL = "Pool1111111111111111111111111111111111111111";
const NEW_POOL = "GraduatedPool11111111111111111111111111111"; // post-graduation venue, NOT in PULSE_POOLS
const SECRET = "pool-mismatch-test-secret";
const live = { ...env, PULSE_MINT: MINT, PULSE_POOLS: POOL, PULSE_WEBHOOK_SECRET: SECRET };

function swapThrough(pool: string, sig: string): any {
  return {
    signature: sig, timestamp: Math.floor(Date.now() / 1000), type: "SWAP", feePayer: "buyer",
    tokenTransfers: [{ fromUserAccount: pool, toUserAccount: "buyer", mint: MINT, tokenAmount: 1000 }],
    nativeTransfers: [{ fromUserAccount: "buyer", toUserAccount: pool, amount: 2_000_000_000 }],
  };
}

async function deliver(txs: any[]): Promise<void> {
  const req = new Request("https://api.pleromachurch.xyz/api/pulse", {
    method: "POST",
    headers: { authorization: SECRET, "content-type": "application/json" },
    body: JSON.stringify(txs),
  });
  expect((await handlePulse(live, req)).status).toBe(200);
}

async function alertRow(): Promise<unknown> {
  return await env.DB.prepare(`SELECT value FROM config WHERE key = 'alert:pulse_pool_mismatch'`).first();
}

describe("pulse pool-mismatch tripwire (stale PULSE_POOLS after graduation)", () => {
  it("silent below threshold → raises on pile-up with zero classified → clears on a classified swap", async () => {
    // [1] A few unclassified deliveries (aggregator routes happen) — below threshold, no alert.
    await deliver([1, 2, 3].map(n => swapThrough(NEW_POOL, `null-${n}`)));
    await alertPoolMismatch(live, Date.now());
    expect(await alertRow()).toBeNull();

    // [2] The pile-up: deliveries keep arriving, none classify — the graduation signature. Raises.
    await deliver([4, 5, 6, 7, 8].map(n => swapThrough(NEW_POOL, `null-${n}`)));
    await alertPoolMismatch(live, Date.now());
    expect(await alertRow()).not.toBeNull();

    // [3] One swap through a configured pool classifies — positive evidence, the alert clears.
    await deliver([swapThrough(POOL, "sided-1")]);
    await alertPoolMismatch(live, Date.now());
    expect(await alertRow()).toBeNull();
  });
});
