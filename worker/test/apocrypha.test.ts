import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
  APOCRYPHA_IP_LIMIT,
  MAX_APOCRYPHA_LENGTH,
  commitApocrypha,
  type ApocryphaEntry,
} from "../src/apocrypha";
import { ModerationUnavailableError, moderateText, validateTextVerdict } from "../src/moderation";
import { applyMigrations } from "./helpers";

beforeAll(() => applyMigrations(env.DB));

async function submit(text: unknown, ip = "203.0.113.9") {
  return SELF.fetch("http://x/api/apocrypha", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify({ text }),
  });
}

describe("validateTextVerdict — strict shape validation", () => {
  it("accepts a well-formed allow", () => {
    expect(validateTextVerdict({ verdict: "allow", category: "none" }))
      .toEqual({ verdict: "allow", category: "none" });
  });

  it("accepts a well-formed reject with a known category", () => {
    expect(validateTextVerdict({ verdict: "reject", category: "hate_speech" }))
      .toEqual({ verdict: "reject", category: "hate_speech" });
  });

  it("returns null on allow with a reject-only category", () => {
    expect(validateTextVerdict({ verdict: "allow", category: "doxx_pii" })).toBeNull();
  });

  it("returns null on allow with a missing category", () => {
    expect(validateTextVerdict({ verdict: "allow" })).toBeNull();
  });

  it("returns null on reject with category none", () => {
    expect(validateTextVerdict({ verdict: "reject", category: "none" })).toBeNull();
  });

  it("returns null on reject with an unknown category", () => {
    expect(validateTextVerdict({ verdict: "reject", category: "not_a_real_category" })).toBeNull();
  });

  it("returns null on reject with a missing category", () => {
    expect(validateTextVerdict({ verdict: "reject" })).toBeNull();
  });

  it("returns null on a garbage verdict value", () => {
    expect(validateTextVerdict({ verdict: "maybe", category: "none" })).toBeNull();
  });

  it("returns null on non-object garbage (string, null, array)", () => {
    expect(validateTextVerdict("allow")).toBeNull();
    expect(validateTextVerdict(null)).toBeNull();
    expect(validateTextVerdict([])).toBeNull();
  });
});

describe("moderateText() — infrastructure failure never fabricates a verdict", () => {
  it("throws ModerationUnavailableError (not a reject) when no clean verdict can be obtained, e.g. no live ANTHROPIC_API_KEY in this suite", async () => {
    await expect(moderateText(env, "a small verse")).rejects.toBeInstanceOf(ModerationUnavailableError);
  });
});

describe("POST /api/apocrypha — validation and rate limiting (all reachable before moderation)", () => {
  it("rejects a missing/non-string text with 400", async () => {
    expect((await submit(undefined, "198.51.100.1")).status).toBe(400);
    expect((await submit(42, "198.51.100.2")).status).toBe(400);
    expect((await submit(null, "198.51.100.3")).status).toBe(400);
  });

  it("rejects empty or whitespace-only text with 400", async () => {
    expect((await submit("", "198.51.100.4")).status).toBe(400);
    expect((await submit("   \n\t  ", "198.51.100.5")).status).toBe(400);
  });

  it("rejects text over the max length with 413", async () => {
    const res = await submit("x".repeat(MAX_APOCRYPHA_LENGTH + 1), "198.51.100.6");
    expect(res.status).toBe(413);
  });

  it("accepts text at exactly the max length up through validation (reaches moderation, not the length gate)", async () => {
    const res = await submit("x".repeat(MAX_APOCRYPHA_LENGTH), "198.51.100.7");
    // No live ANTHROPIC_API_KEY in this suite -> moderateText() throws ModerationUnavailableError,
    // proving the request passed the length gate and reached moderation rather than being
    // rejected for length (which would 413, not 503).
    expect(res.status).toBe(503);
  });

  it("rate-limits by source IP: the (APOCRYPHA_IP_LIMIT + 1)-th submission from one IP is 429", async () => {
    const ip = "198.51.100.8";
    let last: Response | undefined;
    for (let i = 0; i < APOCRYPHA_IP_LIMIT + 1; i++) {
      last = await submit(`verse number ${i}`, ip);
    }
    expect(last!.status).toBe(429);
  });

  it("503s (moderation unavailable) rather than fabricating a rejection, given no live ANTHROPIC_API_KEY in this suite", async () => {
    const res = await submit("a verse that would need real moderation", "198.51.100.20");
    expect(res.status).toBe(503);
    const body = await res.json<{ error: string }>();
    expect(body.error).not.toMatch(/not accepted/i);
  });
});

describe("commitApocrypha + GET /api/apocrypha — the allow-path's own effect, tested directly (see eye.test.ts's own promote-before-perceivable pattern for why)", () => {
  it("a committed verse appears exactly once, listed newest-first", async () => {
    const now = Date.now();
    const idA = await commitApocrypha(env, "the first verse", now);
    const idB = await commitApocrypha(env, "the second verse", now + 1);

    const res = await SELF.fetch("http://x/api/apocrypha");
    expect(res.status).toBe(200);
    const body = await res.json<{ entries: ApocryphaEntry[]; next: string | null }>();
    const ids = body.entries.map((e) => e.id);
    expect(ids.indexOf(idB)).toBeLessThan(ids.indexOf(idA)); // newest (idB) first
    expect(body.entries.filter((e) => e.id === idA)).toHaveLength(1);
  });

  it("paginates via cursor, and rejects a malformed cursor with 400", async () => {
    const now = Date.now();
    for (let i = 0; i < 55; i++) await commitApocrypha(env, `bulk verse ${i}`, now + 1000 + i);

    const first = await SELF.fetch("http://x/api/apocrypha");
    const firstBody = await first.json<{ entries: ApocryphaEntry[]; next: string | null }>();
    expect(firstBody.entries).toHaveLength(50);
    expect(firstBody.next).not.toBeNull();

    const second = await SELF.fetch(`http://x/api/apocrypha?cursor=${encodeURIComponent(firstBody.next!)}`);
    expect(second.status).toBe(200);
    const secondBody = await second.json<{ entries: ApocryphaEntry[]; next: string | null }>();
    expect(secondBody.entries.length).toBeGreaterThan(0);
    const firstIds = new Set(firstBody.entries.map((e) => e.id));
    for (const entry of secondBody.entries) expect(firstIds.has(entry.id)).toBe(false);

    const bad = await SELF.fetch("http://x/api/apocrypha?cursor=not-a-real-cursor");
    expect(bad.status).toBe(400);
  });
});
