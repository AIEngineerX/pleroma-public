import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { acquireLock, releaseLock } from "../src/lock";
import { applyMigrations } from "./helpers";

beforeAll(() => applyMigrations(env.DB));

describe("overlap lock", () => {
  it("grants one holder at a time and frees on release", async () => {
    expect(await acquireLock(env.DB, "tick", "a", 60_000)).toBe(true);
    expect(await acquireLock(env.DB, "tick", "b", 60_000)).toBe(false);
    await releaseLock(env.DB, "tick", "a");
    expect(await acquireLock(env.DB, "tick", "b", 60_000)).toBe(true);
  });

  it("grants an expired lock to a new holder", async () => {
    await acquireLock(env.DB, "tock", "a", -1);
    expect(await acquireLock(env.DB, "tock", "b", 60_000)).toBe(true);
  });
});
