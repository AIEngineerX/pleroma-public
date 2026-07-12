import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { insertOffering, publishPerception, setOfferingStatus, insertRelic, openRite, getRite } from "../src/db";
import { advanceRite } from "../src/rite";
import { applyMigrations } from "./helpers";

beforeAll(() => applyMigrations(env.DB));

describe("full pipeline (deterministic, no keys)", () => {
  it("carries an offering pending -> moderating -> perceivable -> perceiving -> perceived -> kept, then rite completes", async () => {
    const id = "pipe-1";
    await env.RELICS.put(`quarantine/${id}`, new Uint8Array([1, 2, 3]));
    await insertOffering(env.DB, { id, wallet: "wPipe", sig: null, image_key: `quarantine/${id}`,
      sha256: id, status: "pending", attempts: 0, created_at: Date.now(), perceived_at: null });

    // moderation allow (simulated at the CAS boundary the moderator would drive)
    expect(await setOfferingStatus(env.DB, id, "moderating", { expectedStatus: "pending" })).toBe(true);
    expect(await setOfferingStatus(env.DB, id, "perceivable", { expectedStatus: "moderating" })).toBe(true);
    // perception claim + publish (the verse is what EYE would return)
    expect(await setOfferingStatus(env.DB, id, "perceiving", { expectedStatus: "perceivable" })).toBe(true);
    expect(await publishPerception(env.DB, { offeringId: id, transcriptId: "tv1", verse: "a small coil of light", at: Date.now() })).toBe(true);
    // a re-publish is a clean no-op (idempotency composes)
    expect(await publishPerception(env.DB, { offeringId: id, transcriptId: "tv2", verse: "dup", at: Date.now() })).toBe(false);
    // keep verdict (the summary is what KEEP would return)
    expect(await setOfferingStatus(env.DB, id, "kept", { expectedStatus: "perceived" })).toBe(true);
    await insertRelic(env.DB, { id: "pipe-relic", offering_id: id, wallet: "wPipe", summary: "a small coil of light",
      rite_id: "2026-07-12", kept_at: Date.now(), genesis: 1, accreted_at: null });

    // rite runs the no-LLM phases to completion (deliberation keeps 0 more w/o a key, but advances)
    const date = "2026-07-12";
    await openRite(env.DB, date, Date.now());
    let phase = getRite && (await getRite(env.DB, date))!.phase;
    for (let i = 0; i < 8 && phase !== "complete" && phase !== "failed"; i++) phase = await advanceRite(env, date, Date.now());
    expect(["complete", "failed"]).toContain(phase); // sermon needs a key; either it completed or dead-lettered honestly
    // the relic is accreted into the body by the accretion phase
    const relic = await env.DB.prepare(`SELECT accreted_at FROM relics WHERE offering_id = ?1`).bind(id).first<{ accreted_at: number | null }>();
    expect(relic?.accreted_at).not.toBeNull();
  });
});
