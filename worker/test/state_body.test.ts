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
  it("stays dormant and HIDES the configured mint until launched (anti-decoy)", async () => {
    // env.PULSE_MINT is bound (vitest.config) — the mint is wired early (to register the Helius webhook)
    // but must NOT appear in raw /api/state until launched=1.
    expect(env.PULSE_MINT.length).toBeGreaterThan(0); // precondition: a mint IS configured, yet must stay hidden
    const s = await (await SELF.fetch("http://x/api/state")).json<Body>();
    expect(s.phase).toBe("dormant");
    expect(s.mint).toBeNull();   // leak-proof: the real mint never appears in raw /api/state before the reveal
    expect(s.rite).toBeNull();
  });

  it("goes live once launched=1, exposing the env-pinned mint (the same mint PULSE watches)", async () => {
    // Storage is isolated per it() (@cloudflare/vitest-pool-workers): launched starts at '0' from migration 0011.
    await env.DB.prepare(`UPDATE config SET value='1' WHERE key='launched'`).run();
    const s = await (await SELF.fetch("http://x/api/state")).json<Body>();
    expect(s.phase).toBe("live");
    expect(env.PULSE_MINT.length).toBeGreaterThan(0);   // guard: non-empty binding, so the next line is a real assertion
    expect(s.mint).toBe(env.PULSE_MINT); // authoritative source: the pinned mint equals PULSE's mint, never a config phantom
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
