import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { checkRate } from "../src/ratelimit";
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
});
