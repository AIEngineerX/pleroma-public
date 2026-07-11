import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { asleep, CAPS_USD, recordSpend, reserveEstimate, spentToday, underCap } from "../src/budget";
import { applyMigrations } from "./helpers";

beforeAll(() => applyMigrations(env.DB));

describe("budget priest", () => {
  it("accumulates spend and enforces the daily cap", async () => {
    expect(await underCap(env.DB, "llm")).toBe(true);
    await recordSpend(env.DB, "llm", 24.5);
    expect(await spentToday(env.DB, "llm")).toBeCloseTo(24.5);
    expect(await underCap(env.DB, "llm")).toBe(true);
    expect(await asleep(env.DB)).toBe(false);
    await recordSpend(env.DB, "llm", 1.0);
    expect(await underCap(env.DB, "llm")).toBe(false);
    expect(await asleep(env.DB)).toBe(true);
  });

  it("reserveEstimate is a hard ceiling: sequential calls at the boundary never push spend over the cap", async () => {
    await recordSpend(env.DB, "llm", CAPS_USD.llm - 1); // $1 of headroom left today
    const first = await reserveEstimate(env.DB, "llm", 1); // exactly fills the remaining headroom
    expect(first).toBe(true);
    expect(await spentToday(env.DB, "llm")).toBeCloseTo(CAPS_USD.llm, 5);

    // No headroom left: the conditional increment's WHERE clause is false, so the second
    // reservation must be rejected — not merely "unlikely to overshoot" but atomically unable to.
    const second = await reserveEstimate(env.DB, "llm", 1);
    expect(second).toBe(false);
    expect(await spentToday(env.DB, "llm")).toBeLessThanOrEqual(CAPS_USD.llm);
  });

  it("recordSpend(-E) after a successful reserve releases the reservation back to the prior spend", async () => {
    const before = await spentToday(env.DB, "llm");
    const E = 2.5;
    expect(await reserveEstimate(env.DB, "llm", E)).toBe(true);
    expect(await spentToday(env.DB, "llm")).toBeCloseTo(before + E, 5);
    await recordSpend(env.DB, "llm", -E);
    expect(await spentToday(env.DB, "llm")).toBeCloseTo(before, 5);
  });

  it("hard-ceiling invariant: a reservation at the cap boundary, settled to a realistic (lower) actual, never leaves spend over the cap", async () => {
    // Seed spend so only a sliver of headroom remains, then reserve exactly at the boundary —
    // mirroring a provable-upper-bound estimate that fills all remaining headroom.
    await recordSpend(env.DB, "llm", CAPS_USD.llm - 0.02);
    const reserved = 0.02;
    expect(await reserveEstimate(env.DB, "llm", reserved)).toBe(true);
    expect(await spentToday(env.DB, "llm")).toBeCloseTo(CAPS_USD.llm, 5);

    // Settlement to a realistic actual (a provable upper-bound estimate settles DOWN, never up):
    // simulate askMind's settle(actualUsd) via recordSpend(delta).
    const actual = 0.005; // realistic actual is well under the reserved estimate
    await recordSpend(env.DB, "llm", actual - reserved);

    expect(await spentToday(env.DB, "llm")).toBeLessThanOrEqual(CAPS_USD.llm);
    expect(await spentToday(env.DB, "llm")).toBeCloseTo(CAPS_USD.llm - reserved + actual, 5);
  });
});
