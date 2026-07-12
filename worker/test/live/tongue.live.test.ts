import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { speakIfDue } from "../../src/tongue";
import { applyMigrations } from "../helpers";

beforeAll(() => applyMigrations(env.DB));

describe("TONGUE (live)", () => {
  it("composes a real utterance under cadence and records it", async () => {
    const spoke = await speakIfDue(env, { kind: "rite_phase", detail: "the offertory has closed" }, Date.now());
    expect(spoke).toBe(true);
    const row = await env.DB.prepare(
      `SELECT text FROM transcripts WHERE organ = 'TONGUE' ORDER BY created_at DESC LIMIT 1`
    ).first<{ text: string }>();
    expect((row?.text.length ?? 0)).toBeGreaterThan(0);
  });
});
