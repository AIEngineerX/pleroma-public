import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { speak, silentVoice, audioKeyFor } from "../src/voice";
import { recordSpend } from "../src/budget";
import { applyMigrations } from "./helpers";

beforeAll(() => applyMigrations(env.DB));

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
