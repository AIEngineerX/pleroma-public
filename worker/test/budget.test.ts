import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { asleep, CAPS_USD, dayKey, recordSpend, reserveEstimate, spentToday, underCap } from "../src/budget";
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

  it("day-pinned reserve/settle lands on the SAME day even when called across a would-be midnight rollover, and never touches 'today'", async () => {
    const pastDay = "2024-01-01"; // stands in for "the day the reservation was pinned to"
    const reserved = 3;
    expect(await reserveEstimate(env.DB, "llm", reserved, pastDay)).toBe(true);
    expect(await spentToday(env.DB, "llm", pastDay)).toBeCloseTo(reserved, 5);

    const todayBefore = await spentToday(env.DB, "llm");

    // Settle against the SAME pinned day, not whatever dayKey() would return if recomputed now.
    const actual = 1.2;
    await recordSpend(env.DB, "llm", actual - reserved, pastDay);

    expect(await spentToday(env.DB, "llm", pastDay)).toBeCloseTo(actual, 5);
    // "Today" (the no-arg default) is completely unaffected by the pinned-day reservation/settlement.
    expect(await spentToday(env.DB, "llm")).toBeCloseTo(todayBefore, 5);
    expect(pastDay).not.toBe(dayKey());
  });
});
