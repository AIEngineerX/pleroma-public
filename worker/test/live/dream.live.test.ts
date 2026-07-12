import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { composeDream } from "../../src/dream";
import { insertRelic, openRite, advanceRitePhase } from "../../src/db";
import { applyMigrations } from "../helpers";

beforeAll(() => applyMigrations(env.DB));

describe("DREAM (live)", () => {
  it("composes a real narrative + video prompt from the day's relics", async () => {
    const date = "2026-07-22-live";
    await openRite(env.DB, date, Date.now());
    await advanceRitePhase(env.DB, date, "scheduled", "complete", Date.now());
    await insertRelic(env.DB, { id: "dlr1", offering_id: "dlo1", wallet: "wA", summary: "a small sun rising over water",
      rite_id: date, kept_at: Date.now(), genesis: 0, accreted_at: Date.now() });
    const id = await composeDream(env, date);
    expect(id).not.toBeNull();
    const row = await env.DB.prepare(`SELECT narrative, video_prompt FROM dreams WHERE rite_date = ?1`).bind(date).first<{ narrative: string; video_prompt: string }>();
    expect(row?.narrative.length).toBeGreaterThan(0);
    expect(row?.video_prompt.length).toBeGreaterThan(0);
  });
});
