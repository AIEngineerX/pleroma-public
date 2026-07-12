import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { fetchHolders } from "../../src/holders";

describe("holders (live)", () => {
  it("fetches a holder count from Helius DAS when a mint is configured", async () => {
    if (!env.PULSE_MINT || !env.HELIUS_API_KEY) return; // skip until launch config is present
    const { count } = await fetchHolders(env, 3);
    expect(count).toBeGreaterThanOrEqual(0);
  });
});
