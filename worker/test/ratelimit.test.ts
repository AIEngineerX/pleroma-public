import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { checkRate, sweepRateLimits } from "../src/ratelimit";
import { applyMigrations } from "./helpers";

beforeAll(() => applyMigrations(env.DB));

describe("intake rate limiting", () => {
  it("allows up to the limit within a window, then blocks", async () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) expect(await checkRate(env.DB, "ip:1.2.3.4", now, 60_000, 5)).toBe(true);
    expect(await checkRate(env.DB, "ip:1.2.3.4", now, 60_000, 5)).toBe(false); // 6th in-window is blocked
  });

  it("resets in the next window", async () => {
    const now = Date.now();
    expect(await checkRate(env.DB, "ip:5.6.7.8", now, 60_000, 1)).toBe(true);
    expect(await checkRate(env.DB, "ip:5.6.7.8", now, 60_000, 1)).toBe(false);
    expect(await checkRate(env.DB, "ip:5.6.7.8", now + 61_000, 60_000, 1)).toBe(true); // new window
  });

  it("sweepRateLimits reaps expired windows and keeps fresh ones (the table is otherwise insert-only)", async () => {
    const now = Date.parse("2026-08-10T12:00:00Z");
    await checkRate(env.DB, "ip:sweep-old", now - 25 * 60 * 60_000, 60_000, 5);
    await checkRate(env.DB, "ip:sweep-new", now - 60_000, 60_000, 5);
    await sweepRateLimits(env.DB, now);
    const rows = (await env.DB.prepare(
      `SELECT bucket FROM rate_limits WHERE bucket IN ('ip:sweep-old', 'ip:sweep-new')`
    ).all<{ bucket: string }>()).results.map(r => r.bucket);
    expect(rows).toEqual(["ip:sweep-new"]);
  });
});
