import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { askMind, MindAsleepError, estimateCostUsd } from "../src/mind";
import { recordSpend, spentToday, CAPS_USD } from "../src/budget";
import { applyMigrations } from "./helpers";

beforeAll(() => applyMigrations(env.DB));

describe("askMind — hard budget reservation", () => {
  it("estimates cost from maxTokens (output price) plus a chars/4 input upper bound", () => {
    // sonnet-5 prices: [input $3/1M, output $15/1M].
    const est = estimateCostUsd({
      model: "claude-sonnet-5",
      system: "",
      user: [{ type: "text", text: "a".repeat(4000) }], // 4000 chars -> ~1000 input tokens
      maxTokens: 200,
    });
    // input: 1000 tok * 3/1e6 = 0.003 ; output: 200 tok * 15/1e6 = 0.003
    expect(est).toBeCloseTo(0.006, 5);
  });

  it("rejects with MindAsleepError BEFORE any fetch when the estimate would exceed the cap, and records no spend", async () => {
    await recordSpend(env.DB, "llm", CAPS_USD.llm - 1); // $1 of headroom left today
    const before = await spentToday(env.DB, "llm");

    // maxTokens chosen so the output-side estimate alone ($15/1M * 100000 = $1.5) blows the
    // remaining $1 of headroom. If askMind ever reached fetch(), it would hit the real
    // network with a bogus ANTHROPIC_API_KEY and throw a NonRetryableError (HTTP 401), not
    // MindAsleepError — so the specific error type proves the rejection happened pre-fetch.
    await expect(askMind(env, {
      model: "claude-sonnet-5",
      system: "system",
      user: [{ type: "text", text: "hi" }],
      maxTokens: 100_000,
    })).rejects.toBeInstanceOf(MindAsleepError);

    // No spend was recorded by the rejected call: the reservation check ran before any
    // billed work, so spentToday is unchanged.
    expect(await spentToday(env.DB, "llm")).toBeCloseTo(before, 5);
  });

  it("reserves the estimate before calling out, then releases it in full when the call never bills", async () => {
    const req = {
      model: "claude-sonnet-5" as const,
      system: "system",
      user: [{ type: "text" as const, text: "hi" }],
      maxTokens: 50,
    };
    const before = await spentToday(env.DB, "llm");

    // No real ANTHROPIC_API_KEY in this suite ("test-not-set"), so the real network call to
    // Anthropic returns a non-2xx status and askMind throws without ever billing.
    await expect(askMind(env, req)).rejects.toThrow();

    // The finally-settle path releases the full reservation (delta = -reserved) because the
    // call never billed: spend returns to its pre-call baseline, proving the reservation
    // doesn't leak on a failed call.
    expect(await spentToday(env.DB, "llm")).toBeCloseTo(before, 5);
  });
});
