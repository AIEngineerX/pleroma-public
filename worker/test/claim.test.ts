import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
  claimForModeration, claimForPerception, moderationCandidates, perceptionCandidates,
  insertOffering, offeringStatusById, setOfferingStatus,
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

  it("reclaims a stale moderating claim as pure ownership transfer, without consuming a strike", async () => {
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
    expect(row?.attempts).toBe(0); // a tick dying is infra, not the row's fault: the reclaim spends no strike
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

  // Reproduces exactly what runEyeBatch's moderation loop does on one genuine processing error: it read
  // o.attempts from the candidate-query snapshot, claimed the row, then in its catch computed
  // `dead = o.attempts >= 2` and called setOfferingStatus(..., bumpAttempts:true, expectedStatus:'moderating').
  async function claimThenError(id: string, nowMs: number): Promise<{ attempts: number; status: string }> {
    const snap = await env.DB.prepare(`SELECT attempts FROM offerings WHERE id = ?1`)
      .bind(id).first<{ attempts: number }>();
    expect(await claimForModeration(env.DB, id, nowMs, STALE)).toBe(true);
    const dead = (snap?.attempts ?? 0) >= 2;
    await setOfferingStatus(env.DB, id, dead ? "failed" : "pending",
      { bumpAttempts: true, expectedStatus: "moderating" });
    return (await env.DB.prepare(`SELECT attempts, status FROM offerings WHERE id = ?1`)
      .bind(id).first<{ attempts: number; status: string }>())!;
  }

  it("a lease-overrun reclaim never consumes a strike: the row dead-letters only on the 3rd genuine error, not the 2nd", async () => {
    await seed("strike-count", "pending");

    // Cycle 0: a tick claims the pending row, then dies mid-sequence (lease overrun) WITHOUT reaching its
    // catch — the row is left transitional 'moderating' with attempts still 0. This is the crash the
    // double-count bug wrongly charged as a strike.
    const t0 = Date.now();
    expect(await claimForModeration(env.DB, "strike-count", t0, STALE)).toBe(true);
    expect((await env.DB.prepare(`SELECT attempts FROM offerings WHERE id = 'strike-count'`)
      .first<{ attempts: number }>())?.attempts).toBe(0);

    // Cycle 1: a later tick reclaims the stale row (ownership only) then hits a genuine error. First
    // genuine error -> attempts 1. The crash consumed nothing; the old reclaim-bump would read 2 here.
    const c1 = await claimThenError("strike-count", t0 + STALE + 1);
    expect(c1).toMatchObject({ attempts: 1, status: "pending" });

    // Cycle 2: second genuine error -> attempts 2, still not failed.
    const c2 = await claimThenError("strike-count", t0 + STALE + 2);
    expect(c2).toMatchObject({ attempts: 2, status: "pending" });

    // Cycle 3: THIRD genuine error -> dead (attempts >= 2) -> failed. Under the old reclaim-bumps-attempts
    // behavior the crash + first error would already have reached attempts 2 and failed this row at the
    // 2nd genuine error, one cycle early. The clean 3-strike is the regression guard.
    const c3 = await claimThenError("strike-count", t0 + STALE + 3);
    expect(c3.status).toBe("failed");
  });
});
