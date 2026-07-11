import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { asleep, recordSpend, spentToday, underCap } from "../src/budget";
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
});
