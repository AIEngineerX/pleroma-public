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
});
