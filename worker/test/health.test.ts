import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers";

beforeAll(() => applyMigrations(env.DB));

async function stampTick(at: number): Promise<void> {
  await env.DB.prepare(`INSERT INTO config (key, value) VALUES ('tick_ok', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1`)
    .bind(String(at)).run();
}

describe("health", () => {
  it("reports healthy on a never-run worker so a monitor does not false-alarm before the first cron", async () => {
    const res = await SELF.fetch("http://x/api/health"); // no tick_ok stamped yet (isolated storage)
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, env: "dev" });
  });

  it("reports healthy while the tick heartbeat is fresh", async () => {
    await stampTick(Date.now());
    const res = await SELF.fetch("http://x/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, env: "dev" });
  });

  it("goes 503 once the tick heartbeat is stale (a fully-dead loop an external monitor can catch)", async () => {
    await stampTick(Date.now() - 60 * 60_000); // older than the 45-min staleness window
    const res = await SELF.fetch("http://x/api/health");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, env: "dev", stale: true });
  });
});
