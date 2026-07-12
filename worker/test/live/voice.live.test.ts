import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { speak, vendorFor } from "../../src/voice";
import { applyMigrations } from "../helpers";

beforeAll(() => applyMigrations(env.DB));

describe("TTS (live)", () => {
  it("synthesizes real audio with the configured vendor and caches it", async () => {
    // Requires VOICE_VENDOR + the vendor key in .dev.vars; with the silent default this still exercises speak().
    const r = await speak(env, "First light. I begin again.", vendorFor(env));
    expect(r.spoken || r.cached).toBe(true);
    const obj = await env.RELICS.get(r.audioKey);
    expect(obj).not.toBeNull();
    await obj?.arrayBuffer();
  });
});
