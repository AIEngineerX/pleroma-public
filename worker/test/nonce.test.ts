import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { nonceIsFresh } from "../src/nonce";
import { applyMigrations } from "./helpers";

beforeAll(() => applyMigrations(env.DB));

describe("nonce", () => {
  it("a freshly issued nonce validates as fresh", async () => {
    const res = await SELF.fetch("http://x/api/nonce");
    expect(res.status).toBe(200);
    const { nonce, expires_at } = await res.json<{ nonce: string; expires_at: number }>();
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(expires_at).toBeGreaterThan(Date.now());
    expect(await nonceIsFresh(env.DB, nonce)).toBe(true);
  });

  it("rejects unknown nonces", async () => {
    expect(await nonceIsFresh(env.DB, "deadbeefdeadbeefdeadbeefdeadbeef")).toBe(false);
  });

  it("rejects an expired nonce", async () => {
    const expired = "e".repeat(32);
    await env.DB.prepare(`INSERT INTO nonces (nonce, expires_at) VALUES (?1, ?2)`)
      .bind(expired, Date.now() - 1_000).run();
    expect(await nonceIsFresh(env.DB, expired)).toBe(false);
  });
});
