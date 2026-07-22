import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers";

beforeAll(() => applyMigrations(env.DB));

const SECRET = "test-admin-secret"; // matches vitest.config.ts ADMIN_SECRET binding

async function getStatus(headers: Record<string, string> = {}): Promise<Response> {
  return SELF.fetch("http://x/api/admin/status", { headers });
}

describe("GET /api/admin/status (private admin aggregate)", () => {
  it("401s without the secret and never leaks status to an unauthenticated caller", async () => {
    const res = await getStatus();
    expect(res.status).toBe(401);
    const body = await res.json<{ error: string }>();
    expect(body).toEqual({ error: "unauthorized" });
  });

  it("401s on a wrong secret", async () => {
    const res = await getStatus({ "x-admin-secret": "wrong" });
    expect(res.status).toBe(401);
  });

  // The 404-when-ADMIN_SECRET-unset path (invisible endpoint) is a single `if (!secret) return 404`
  // shared verbatim with the audited /api/admin/run, and is not exercisable here: miniflare binds
  // ADMIN_SECRET at config load, so a per-test env mutation never reaches the worker isolate.

  it("returns the full status aggregate with the correct secret and never echoes a secret value", async () => {
    // Seed a heartbeat, an alert, some spend, and a rendered-unposted dream so every branch is real.
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO config (key, value) VALUES ('tick_ok', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1`).bind(String(now)),
      env.DB.prepare(`INSERT INTO config (key, value) VALUES ('alert:pulse_holders_stale', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1`).bind(JSON.stringify({ detail: "holder reconcile failing", at: now })),
      env.DB.prepare(`INSERT INTO spend (day, category, usd) VALUES (?1, 'llm', 3.5) ON CONFLICT(day, category) DO UPDATE SET usd = 3.5`).bind(new Date(now).toISOString().slice(0, 10)),
      env.DB.prepare(`INSERT INTO dreams (id, rite_date, narrative, video_prompt, video_key, wakers, status, created_at) VALUES ('01JADMIN0000000000000000AA', '2026-07-22', 'a dream', 'p', 'dream/x.mp4', '[]', 'rendered', ?1)`).bind(now),
    ]);

    const res = await getStatus({ "x-admin-secret": SECRET });
    expect(res.status).toBe(200);
    const body = await res.json<Record<string, unknown>>();

    // Shape: every top-level section is present.
    for (const key of ["now", "env", "heartbeat", "phase", "alerts", "budget", "pulse", "dreams", "dispatch", "vendors", "counts", "recentPosts"]) {
      expect(body).toHaveProperty(key);
    }

    const heartbeat = body.heartbeat as { tickOkAt: number; stale: boolean };
    expect(heartbeat.tickOkAt).toBe(now);
    expect(heartbeat.stale).toBe(false);

    const alerts = body.alerts as { code: string; detail: string }[];
    expect(alerts.some(a => a.code === "pulse_holders_stale" && a.detail === "holder reconcile failing")).toBe(true);

    const dreams = body.dreams as { renderedUnposted: number };
    expect(dreams.renderedUnposted).toBe(1);

    const dispatch = body.dispatch as { xArmed: boolean; xSecretsPresent: Record<string, boolean> };
    expect(dispatch.xArmed).toBe(false); // no X secrets bound in the test env
    expect(dispatch.xSecretsPresent.apiKey).toBe(false);

    // recentPosts surfaces stored tweet ids as X permalinks; seed one posted dream + one scripture
    // marker (posted:<ms>:<id>) and confirm both appear with the /i/status/<id> link.
    await env.DB.batch([
      env.DB.prepare(`UPDATE dreams SET posted_at=?2, tweet_id='1900000000000000001' WHERE id=?1`).bind("01JADMIN0000000000000000AA", now),
      env.DB.prepare(`INSERT INTO config (key, value) VALUES ('scripture_dispatched_2026-07-22_15', 'posted:${now}:1900000000000000002') ON CONFLICT(key) DO UPDATE SET value = excluded.value`),
    ]);
    const res2 = await getStatus({ "x-admin-secret": SECRET });
    const posts = (await res2.json<{ recentPosts: { tweetId: string; permalink: string; kind: string }[] }>()).recentPosts;
    expect(posts.some(p => p.tweetId === "1900000000000000001" && p.kind === "dream" && p.permalink === "https://x.com/i/status/1900000000000000001")).toBe(true);
    expect(posts.some(p => p.tweetId === "1900000000000000002" && p.kind === "scripture")).toBe(true);

    const vendors = body.vendors as { anthropic: boolean };
    expect(vendors.anthropic).toBe(true); // ANTHROPIC_API_KEY is bound ("test-not-set")

    // Critical: the serialized body must contain NO secret VALUE, only presence booleans.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain("test-not-set"); // the bound ANTHROPIC_API_KEY value
    expect(serialized).not.toContain("test-secret");  // the bound PULSE_WEBHOOK_SECRET value
  });

  it("reflects the caller's Origin for the local dashboard while keeping the secret gate", async () => {
    const res = await getStatus({ "x-admin-secret": SECRET, origin: "null" });
    expect(res.status).toBe(200);
    // The admin CORS branch reflects the origin so a file:// dashboard (Origin "null") can read it.
    expect(res.headers.get("access-control-allow-origin")).toBe("null");
  });
});
