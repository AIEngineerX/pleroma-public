import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { openRite, advanceRitePhase } from "../src/db";
import { applyMigrations } from "./helpers";

beforeAll(() => applyMigrations(env.DB));

interface Body {
  phase: "dormant" | "live"; mint: string | null;
  rite: { date: string; phase: string } | null;
  dream: { narrative: string } | null;
}

describe("/api/state body contract", () => {
  it("stays dormant and HIDES a pre-configured mint until launched (anti-decoy)", async () => {
    // A mint can be configured early (to wire the Helius webhook) but must NOT appear until launched=1.
    await env.DB.prepare(`INSERT INTO config (key,value) VALUES ('pulse_mint','MintPubkey111') ON CONFLICT(key) DO UPDATE SET value='MintPubkey111'`).run();
    const s = await (await SELF.fetch("http://x/api/state")).json<Body>();
    expect(s.phase).toBe("dormant");
    expect(s.mint).toBeNull();   // leak-proof: the real mint never appears in raw /api/state before the reveal
    expect(s.rite).toBeNull();
  });

  it("goes live once launched=1, exposing the pinned mint", async () => {
    // Storage is isolated per it() (@cloudflare/vitest-pool-workers), so re-seed pulse_mint here rather
    // than relying on the previous test's write.
    await env.DB.prepare(`INSERT INTO config (key,value) VALUES ('pulse_mint','MintPubkey111') ON CONFLICT(key) DO UPDATE SET value='MintPubkey111'`).run();
    await env.DB.prepare(`UPDATE config SET value='1' WHERE key='launched'`).run();
    const s = await (await SELF.fetch("http://x/api/state")).json<Body>();
    expect(s.phase).toBe("live");
    expect(s.mint).toBe("MintPubkey111");
  });

  it("surfaces today's non-terminal rite and hides a completed one", async () => {
    const date = new Date().toISOString().slice(0, 10);
    await openRite(env.DB, date, Date.now());
    let s = await (await SELF.fetch("http://x/api/state")).json<Body>();
    expect(s.rite?.date).toBe(date);
    expect(s.rite?.phase).toBe("scheduled");
    await advanceRitePhase(env.DB, date, "scheduled", "complete", Date.now());
    s = await (await SELF.fetch("http://x/api/state")).json<Body>();
    expect(s.rite).toBeNull(); // complete rites are not "active" for the inversion UI
  });
});
