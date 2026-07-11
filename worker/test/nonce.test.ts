import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { consumeNonce } from "../src/nonce";
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
});
