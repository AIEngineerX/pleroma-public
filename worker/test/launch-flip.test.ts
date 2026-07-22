import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers";
import { handlePulse } from "../src/pulse";
import { getState } from "../src/read";

beforeAll(() => applyMigrations(env.DB));

// A THROWAWAY placeholder mint + pool. The Worker never validates the mint on-chain — it only
// string-matches it inside the incoming webhook payload (classifySwap) — so any value works for a
// rehearsal. The realism is in the synthetic Helius enriched-swap shape below, not the address.
const MINT = "TeStBecoM1ngLaunchRehearsa1111111111111111";
const POOL = "TeStPoo1Launch111111111111111111111111111";
const SECRET = "rehearsal-webhook-secret";

// A user buying the token: SOL leaves the user into the pool (nativeTransfers), the token leaves the
// pool to the user (tokenTransfers) — exactly the shape Helius posts and pulse.ts reads.
function buyTx(sig: string, sol = 2) {
  return {
    signature: sig, timestamp: Math.floor(Date.now() / 1000), type: "SWAP", feePayer: "buyer",
    tokenTransfers: [{ fromUserAccount: POOL, toUserAccount: "buyer", mint: MINT, tokenAmount: 1000 }],
    nativeTransfers: [{ fromUserAccount: "buyer", toUserAccount: POOL, amount: sol * 1_000_000_000 }],
  };
}

async function stateOf(e: unknown): Promise<Record<string, any>> {
  return await (await getState(e as never)).json() as Record<string, any>;
}

describe("LAUNCH REHEARSAL — mint pin + launched flip + first swaps make the heart beat", () => {
  it("dormant → live (pinned) → beating, on a throwaway mint and synthetic Helius swaps", async () => {
    const live = { ...env, PULSE_MINT: MINT, PULSE_POOLS: POOL, PULSE_WEBHOOK_SECRET: SECRET };

    // [0] DORMANT — no mint pinned, not launched. This is prod right now.
    const s0 = await stateOf({ ...env, PULSE_MINT: "" });
    console.log("[0] DORMANT       ", JSON.stringify({ phase: s0.phase, mint: s0.mint, vitals: s0.vitals }));
    expect(s0.phase).toBe("dormant");
    expect(s0.mint).toBeNull();

    // [1] THE PIN — set PULSE_MINT + PULSE_POOLS (at launch: wrangler.toml [env.production] vars
    // + deploy, launch-day7.md §3.4 — BOTH, or classifySwap attributes nothing) + flip launched=1
    // (wrangler d1 execute).
    await env.DB.prepare(
      "INSERT INTO config (key,value) VALUES ('launched','1') ON CONFLICT(key) DO UPDATE SET value='1'",
    ).run();
    const s1 = await stateOf(live);
    console.log("[1] LIVE, at rest ", JSON.stringify({ phase: s1.phase, mint: s1.mint, vitals: s1.vitals }));
    expect(s1.phase).toBe("live");
    expect(s1.mint).toBe(MINT);
    expect(s1.vitals.state).toBe("starving"); // heart present, no trades yet

    // [2] FIRST SWAPS — the Helius webhook POSTs enriched swaps to /api/pulse with the matching authHeader.
    const req = new Request("https://api.pleromachurch.xyz/api/pulse", {
      method: "POST",
      headers: { authorization: SECRET, "content-type": "application/json" },
      body: JSON.stringify([buyTx("reh1"), buyTx("reh2"), buyTx("reh3"), buyTx("reh4")]),
    });
    const pulseRes = await handlePulse(live, req);
    const ingest = await pulseRes.json() as Record<string, any>;
    console.log("[2] /api/pulse    ", JSON.stringify(ingest));
    expect(pulseRes.status).toBe(200);
    expect(ingest.ingested).toBe(4);

    // [3] THE HEART BEATS — vitals derive from the deduped pulse_events; state moves off starving.
    const s2 = await stateOf(live);
    console.log("[3] LIVE, BEATING ", JSON.stringify({ phase: s2.phase, mint: s2.mint, vitals: s2.vitals }));
    expect(s2.phase).toBe("live");
    expect(s2.vitals.buys).toBe(4);
    expect(s2.vitals.state).not.toBe("starving");

    // [4] AUTH GATE — a webhook without the matching secret is rejected (nothing ingests).
    const bad = await handlePulse(live, new Request("https://api.pleromachurch.xyz/api/pulse", {
      method: "POST", headers: { authorization: "wrong", "content-type": "application/json" }, body: "[]",
    }));
    console.log("[4] wrong secret  ", bad.status);
    expect(bad.status).toBe(401);
  });
});
