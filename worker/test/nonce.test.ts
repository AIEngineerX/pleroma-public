import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { consumeNonce, releaseNonce } from "../src/nonce";
import { applyMigrations } from "./helpers";

beforeAll(() => applyMigrations(env.DB));

describe("nonce", () => {
  it("issues a nonce consumable exactly once", async () => {
    const res = await SELF.fetch("http://x/api/nonce");
    expect(res.status).toBe(200);
    const { nonce, expires_at } = await res.json<{ nonce: string; expires_at: number }>();
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(expires_at).toBeGreaterThan(Date.now());
    expect(await consumeNonce(env.DB, nonce)).toBe(true);
    expect(await consumeNonce(env.DB, nonce)).toBe(false);
  });

  it("rejects unknown nonces", async () => {
    expect(await consumeNonce(env.DB, "deadbeefdeadbeefdeadbeefdeadbeef")).toBe(false);
  });

  it("releaseNonce returns a consumed nonce to the unused pool so it can be consumed again", async () => {
    const res = await SELF.fetch("http://x/api/nonce");
    const { nonce } = await res.json<{ nonce: string; expires_at: number }>();
    expect(await consumeNonce(env.DB, nonce)).toBe(true);
    await releaseNonce(env.DB, nonce);
    expect(await consumeNonce(env.DB, nonce)).toBe(true);
  });

  it("releaseNonce is a no-op on an expired nonce — it never re-opens an expired token", async () => {
    const expired = "e".repeat(32);
    await env.DB.prepare(`INSERT INTO nonces (nonce, expires_at, used) VALUES (?1, ?2, 1)`)
      .bind(expired, Date.now() - 1_000).run();
    await releaseNonce(env.DB, expired);
    expect(await consumeNonce(env.DB, expired)).toBe(false);
  });
});
