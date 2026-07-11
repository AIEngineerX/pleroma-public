import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { askMind, MindAsleepError, estimateCostUsd } from "../src/mind";
import { recordSpend, spentToday, CAPS_USD } from "../src/budget";
import { applyMigrations } from "./helpers";

beforeAll(() => applyMigrations(env.DB));

describe("askMind — hard budget reservation", () => {
  it("estimates cost from maxTokens (output price) plus a UTF-8-byte input upper bound", () => {
    // sonnet-5 prices: [input $3/1M, output $15/1M]. FRAMING_TOKENS = 20 is always added.
    const est = estimateCostUsd({
      model: "claude-sonnet-5",
      system: "",
      user: [{ type: "text", text: "a".repeat(4000) }], // 4000 single-byte chars -> 4000 input tokens
      maxTokens: 200,
    });
    // input: (4000 + 20) tok * 3/1e6 = 0.01206 ; output: 200 tok * 15/1e6 = 0.003
    expect(est).toBeCloseTo(0.01506, 5);
  });

  it("bounds an image's contribution by the IMAGE_TOKENS_MAX constant, not the base64 payload length", () => {
    const reqSmallImage = {
      model: "claude-sonnet-5" as const,
      system: "sys",
      user: [
        { type: "text" as const, text: "describe this" },
        { type: "image" as const, mediaType: "image/png", dataB64: "a".repeat(100) },
      ],
      maxTokens: 200,
    };
    const reqHugeImage = {
      ...reqSmallImage,
      user: [
        reqSmallImage.user[0],
        { type: "image" as const, mediaType: "image/png", dataB64: "a".repeat(500_000) }, // ~512KB base64
      ],
    };
    // Same text + same maxTokens, wildly different base64 length -> identical estimate, because
    // the image's contribution is the IMAGE_TOKENS_MAX constant ceiling, not proportional to
    // base64 length.
    expect(estimateCostUsd(reqHugeImage)).toBeCloseTo(estimateCostUsd(reqSmallImage), 10);

    // A plausible actual (small real input/output token counts for a terse EYE verse response)
    // must fall at or under the estimate — the estimate is a provable upper bound, not merely a
    // typical one.
    const [inP, outP] = [3, 15];
    const plausibleActual = (600 * inP + 60 * outP) / 1_000_000; // ~600 input tok, ~60 output tok
    expect(plausibleActual).toBeLessThanOrEqual(estimateCostUsd(reqSmallImage));
  });

  it("reserves against the 8000-token IMAGE_TOKENS_MAX ceiling per image (raised from 4000 to stay above Sonnet's ~4784 tok/image auto high-res billing)", () => {
    const est = estimateCostUsd({
      model: "claude-sonnet-5",
      system: "",
      user: [{ type: "image", mediaType: "image/png", dataB64: "a" }],
      maxTokens: 0,
    });
    // input: (8000 + 20 framing) tok * 3/1e6 ; output: 0
    expect(est).toBeCloseTo((8020 * 3) / 1_000_000, 8);
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
