import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("health", () => {
  it("returns ok with environment", async () => {
    const res = await SELF.fetch("http://x/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, env: "dev" });
  });
});
