import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { capFor, trailing7DayAvg, recordSpend } from "../src/budget";
import { applyMigrations } from "./helpers";

beforeAll(() => applyMigrations(env.DB));

describe("config-driven caps + monthly enforcement", () => {
  it("falls back to the constant cap, then honors a lowered config cap", async () => {
    expect(await capFor(env.DB, "llm")).toBe(25); // default
    await env.DB.prepare(`INSERT INTO config (key, value) VALUES ('cap:llm', '10') ON CONFLICT(key) DO UPDATE SET value='10'`).run();
    expect(await capFor(env.DB, "llm")).toBe(10); // lowered without a deploy
  });

  it("computes the trailing-7-day average daily spend", async () => {
    const today = "2026-07-12";
    await recordSpend(env.DB, "llm", 7, "2026-07-11");
    await recordSpend(env.DB, "llm", 14, "2026-07-10");
    const avg = await trailing7DayAvg(env.DB, "llm", today);
    expect(avg).toBeCloseTo((7 + 14) / 7); // sum over 7 days / 7
  });
});
