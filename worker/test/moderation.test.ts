import { describe, expect, it } from "vitest";
import { validateVerdict } from "../src/moderation";

describe("moderation schema — strict fail-closed", () => {
  it("accepts a well-formed allow", () => {
    expect(validateVerdict({ verdict: "allow", category: "none" }))
      .toEqual({ verdict: "allow", category: "none" });
  });

  it("accepts a well-formed reject with a known category", () => {
    expect(validateVerdict({ verdict: "reject", category: "gore" }))
      .toEqual({ verdict: "reject", category: "gore" });
  });

  it("fails closed on allow with a reject-only category", () => {
    expect(validateVerdict({ verdict: "allow", category: "sexual_minors" }))
      .toEqual({ verdict: "reject", category: "moderation_unavailable" });
  });

  it("fails closed on allow with a missing category", () => {
    expect(validateVerdict({ verdict: "allow" }))
      .toEqual({ verdict: "reject", category: "moderation_unavailable" });
  });

  it("fails closed on reject with category none", () => {
    expect(validateVerdict({ verdict: "reject", category: "none" }))
      .toEqual({ verdict: "reject", category: "moderation_unavailable" });
  });

  it("fails closed on reject with an unknown category", () => {
    expect(validateVerdict({ verdict: "reject", category: "not_a_real_category" }))
      .toEqual({ verdict: "reject", category: "moderation_unavailable" });
  });

  it("fails closed on reject with a missing category", () => {
    expect(validateVerdict({ verdict: "reject" }))
      .toEqual({ verdict: "reject", category: "moderation_unavailable" });
  });

  it("fails closed on a garbage verdict value", () => {
    expect(validateVerdict({ verdict: "maybe", category: "none" }))
      .toEqual({ verdict: "reject", category: "moderation_unavailable" });
  });

  it("fails closed on non-object garbage (string, null, array)", () => {
    expect(validateVerdict("allow")).toEqual({ verdict: "reject", category: "moderation_unavailable" });
    expect(validateVerdict(null)).toEqual({ verdict: "reject", category: "moderation_unavailable" });
    expect(validateVerdict([])).toEqual({ verdict: "reject", category: "moderation_unavailable" });
  });
});
