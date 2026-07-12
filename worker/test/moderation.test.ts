import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { validateVerdict, moderate, ModerationUnavailableError } from "../src/moderation";

describe("moderation schema — strict shape validation", () => {
  it("accepts a well-formed allow", () => {
    expect(validateVerdict({ verdict: "allow", category: "none" }))
      .toEqual({ verdict: "allow", category: "none" });
  });

  it("accepts a well-formed reject with a known category", () => {
    expect(validateVerdict({ verdict: "reject", category: "gore" }))
      .toEqual({ verdict: "reject", category: "gore" });
  });

  it("returns null on allow with a reject-only category", () => {
    expect(validateVerdict({ verdict: "allow", category: "sexual_minors" })).toBeNull();
  });

  it("returns null on allow with a missing category", () => {
    expect(validateVerdict({ verdict: "allow" })).toBeNull();
  });

  it("returns null on reject with category none", () => {
    expect(validateVerdict({ verdict: "reject", category: "none" })).toBeNull();
  });

  it("returns null on reject with an unknown category", () => {
    expect(validateVerdict({ verdict: "reject", category: "not_a_real_category" })).toBeNull();
  });

  it("returns null on reject with a missing category", () => {
    expect(validateVerdict({ verdict: "reject" })).toBeNull();
  });

  it("returns null on a garbage verdict value", () => {
    expect(validateVerdict({ verdict: "maybe", category: "none" })).toBeNull();
  });

  it("returns null on non-object garbage (string, null, array)", () => {
    expect(validateVerdict("allow")).toBeNull();
    expect(validateVerdict(null)).toBeNull();
    expect(validateVerdict([])).toBeNull();
  });
});

const PNG = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
), c => c.charCodeAt(0));

describe("moderate() — infrastructure failure never fabricates a verdict", () => {
  it("throws ModerationUnavailableError (not a reject) when no clean verdict can be obtained, e.g. no live ANTHROPIC_API_KEY in this suite", async () => {
    // Fixes the bug this commit addresses: a bad/missing key, timeout, or malformed response must
    // signal unavailability so the caller (eye.ts) retries — it must NEVER return a fabricated
    // {verdict:"reject"} that would cause the offering to be destroyed.
    await expect(moderate(env, PNG, "image/png")).rejects.toBeInstanceOf(ModerationUnavailableError);
  });
});
