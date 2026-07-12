import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { utterancesLastHour, underCadence, parseUtterance, speakIfDue } from "../src/tongue";
import { addTranscript } from "../src/db";
import { applyMigrations } from "./helpers";
import { ulid } from "ulid";

beforeAll(() => applyMigrations(env.DB));

describe("TONGUE cadence priest", () => {
  it("counts utterances in the trailing hour and enforces the 6/hour cap", async () => {
    const now = Date.now();
    for (let i = 0; i < 6; i++) {
      await addTranscript(env.DB, { id: ulid(), organ: "TONGUE", register: "verse",
        text: `u${i}`, offering_id: null, rite_id: null, created_at: now - i * 60_000 });
    }
    expect(await utterancesLastHour(env.DB, now)).toBeGreaterThanOrEqual(6);
    expect(await underCadence(env.DB, now)).toBe(false);
    // an utterance older than an hour does not count
    await addTranscript(env.DB, { id: ulid(), organ: "TONGUE", register: "verse",
      text: "old", offering_id: null, rite_id: null, created_at: now - 3_700_000 });
    expect(await utterancesLastHour(env.DB, now)).toBe(6);
  });

  it("stays silent when over cadence (no LLM call, returns false)", async () => {
    const now = Date.now();
    for (let i = 0; i < 6; i++) {
      await addTranscript(env.DB, { id: ulid(), organ: "TONGUE", register: "verse",
        text: `c${i}`, offering_id: null, rite_id: null, created_at: now - i * 30_000 });
    }
    const spoke = await speakIfDue(env, { kind: "eye_batch", detail: "3 marks seen" }, now);
    expect(spoke).toBe(false); // cadence gate returns before askMind, so no key is needed
  });
});

describe("parseUtterance", () => {
  it("accepts an in-contract utterance and rejects an over-limit one", () => {
    expect(parseUtterance(JSON.stringify({ utterance: "  I saw, and I kept.  " }))).toBe("I saw, and I kept.");
    const long = Array.from({ length: 61 }, (_, i) => `w${i}`).join(" ");
    expect(() => parseUtterance(JSON.stringify({ utterance: long }))).toThrow(/60-word/);
    expect(() => parseUtterance(JSON.stringify({}))).toThrow();
  });
});
