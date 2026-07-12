import { describe, expect, it } from "vitest";
import { RITE_LEASE_MS, RITE_MAX_PHASE_TAIL_MS, RITE_SAFETY_MARGIN_MS, RITE_WORK_BUDGET_MS } from "../src/leases";

describe("rite lock-lease budget arithmetic", () => {
  it("work budget + worst phase tail + safety margin stays within the lease", () => {
    expect(RITE_WORK_BUDGET_MS).toBeGreaterThan(0);
    expect(RITE_WORK_BUDGET_MS + RITE_MAX_PHASE_TAIL_MS + RITE_SAFETY_MARGIN_MS).toBeLessThanOrEqual(RITE_LEASE_MS);
  });
  it("the worst tail covers a KEEP item's two bounded askMind calls (verdict + inline speakIfDue)", () => {
    // one askMind worst path (Part 1 bounds the body read): fetch 30s + backoff 2s + fetch 30s + body 30s = 92s
    const ONE_ASKMIND_WORST_MS = 30_000 + 2_000 + 30_000 + 30_000;
    expect(RITE_MAX_PHASE_TAIL_MS).toBeGreaterThanOrEqual(2 * ONE_ASKMIND_WORST_MS);
  });
});
