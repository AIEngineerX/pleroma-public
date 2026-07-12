import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
  claimForModeration, claimForPerception, moderationCandidates, perceptionCandidates,
  insertOffering, offeringStatusById,
} from "../src/db";
import { applyMigrations } from "./helpers";

beforeAll(() => applyMigrations(env.DB));

const STALE = 10 * 60_000;

async function seed(id: string, status: "pending" | "perceivable") {
  await insertOffering(env.DB, { id, wallet: null, sig: null, image_key: `quarantine/${id}`,
    sha256: id, status, attempts: 0, created_at: Date.now(), perceived_at: null });
}

describe("per-row claim", () => {
  it("lets exactly one tick claim a pending row for moderation", async () => {
    await seed("claim-mod", "pending");
    const now = Date.now();
    expect(await claimForModeration(env.DB, "claim-mod", now, STALE)).toBe(true);
    expect(await claimForModeration(env.DB, "claim-mod", now, STALE)).toBe(false); // second tick loses
    expect(await offeringStatusById(env.DB, "claim-mod")).toBe("moderating");
  });

  it("reclaims a stale moderating claim and bumps attempts", async () => {
    await seed("claim-stale", "pending");
    const t0 = Date.now();
    expect(await claimForModeration(env.DB, "claim-stale", t0, STALE)).toBe(true);
    // A fresh claim now fails (not stale yet)...
    expect(await claimForModeration(env.DB, "claim-stale", t0 + 1000, STALE)).toBe(false);
    // ...but a claim past the lease reclaims it (the owning tick provably died).
    const later = t0 + STALE + 1;
    expect(await claimForModeration(env.DB, "claim-stale", later, STALE)).toBe(true);
    const row = await env.DB.prepare(`SELECT attempts FROM offerings WHERE id = ?1`)
      .bind("claim-stale").first<{ attempts: number }>();
    expect(row?.attempts).toBe(1); // reclaim counts as an attempt so a perpetually-stalling row dead-letters
  });

  it("claims a perceivable row for perception the same way", async () => {
    await seed("claim-perc", "perceivable");
    const now = Date.now();
    expect(await claimForPerception(env.DB, "claim-perc", now, STALE)).toBe(true);
    expect(await claimForPerception(env.DB, "claim-perc", now, STALE)).toBe(false);
    expect(await offeringStatusById(env.DB, "claim-perc")).toBe("perceiving");
  });

  it("candidate queries include fresh work and stale-reclaimable transitional rows, not fresh in-flight ones", async () => {
    await seed("cand-pending", "pending");
    await seed("cand-perceivable", "perceivable");
    await seed("cand-inflight", "pending");
    const now = Date.now();
    await claimForModeration(env.DB, "cand-inflight", now, STALE); // fresh moderating -> excluded

    const modIds = (await moderationCandidates(env.DB, now + 1000, STALE, 50)).map(o => o.id);
    expect(modIds).toContain("cand-pending");
    expect(modIds).not.toContain("cand-inflight");

    // After the lease, the stalled row reappears as a candidate.
    const modIdsLater = (await moderationCandidates(env.DB, now + STALE + 1, STALE, 50)).map(o => o.id);
    expect(modIdsLater).toContain("cand-inflight");

    const percIds = (await perceptionCandidates(env.DB, now + 1000, STALE, 50)).map(o => o.id);
    expect(percIds).toContain("cand-perceivable");
  });
});
