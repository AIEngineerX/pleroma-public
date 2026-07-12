import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { speak, silentVoice, audioKeyFor, BilledBodyReadError, type VoiceVendor } from "../src/voice";
import { recordSpend, dayKey } from "../src/budget";
import { applyMigrations } from "./helpers";

beforeAll(() => applyMigrations(env.DB));

async function ttsSpend(): Promise<number> {
  const r = await env.DB.prepare(`SELECT usd FROM spend WHERE category = 'tts' AND day = ?1`)
    .bind(dayKey()).first<{ usd: number }>();
  return r?.usd ?? 0;
}

describe("TTS cache + cap", () => {
  it("synthesizes once, then serves the identical text from the R2 cache with no second spend", async () => {
    const vendor = silentVoice();
    const text = "The offertory has closed. I have kept three marks.";
    const first = await speak(env, text, vendor);
    expect(first.spoken).toBe(true);
    expect(first.cached).toBe(false);
    const stored = await env.RELICS.get(first.audioKey);
    expect(stored).not.toBeNull();
    await stored?.arrayBuffer();

    const second = await speak(env, text, vendor);
    expect(second.cached).toBe(true);   // served from R2
    expect(second.spoken).toBe(false);  // no new synthesis
    expect(second.audioKey).toBe(first.audioKey);
    expect(second.audioKey).toBe(await audioKeyFor(text));
  });

  it("does not synthesize when the TTS daily cap is already reached (text-only fallback)", async () => {
    await recordSpend(env.DB, "tts", 5); // exhaust the $5/day cap
    const r = await speak(env, "a fresh line never spoken before", silentVoice());
    expect(r.spoken).toBe(false);
    expect(await env.RELICS.get(r.audioKey)).toBeNull(); // nothing written
  });
});

describe("TTS billing on a body-read failure (never understate spend)", () => {
  // A real (test-purpose) VoiceVendor implementing the interface — not a mock — that throws to exercise
  // speak()'s reservation reconciliation, exactly as a real vendor would on a stalled response body.
  it("KEEPS the reservation when the body read fails after a billed 200 (BilledBodyReadError)", async () => {
    const text = "a billed sermon whose response body stalls after the vendor returned 200";
    const est = text.length * 0.00003; // USD_PER_CHAR_UPPER
    const billedFail: VoiceVendor = {
      name: "test-billed",
      async synthesize() { throw new BilledBodyReadError("body read timed out after 200"); },
    };
    await expect(speak(env, text, billedFail)).rejects.toBeInstanceOf(BilledBodyReadError);
    expect(await ttsSpend()).toBeCloseTo(est, 8); // reservation kept: the vendor billed, so the estimate stands
  });

  it("RELEASES the reservation on a pre-200 failure (nothing billed)", async () => {
    const text = "a sermon whose vendor errors before any 200 response arrives";
    const preFail: VoiceVendor = {
      name: "test-pre",
      async synthesize() { throw new Error("connection refused"); },
    };
    await expect(speak(env, text, preFail)).rejects.toThrow();
    expect(await ttsSpend()).toBeCloseTo(0, 8); // released: no synthesis, nothing to attribute
  });
});
