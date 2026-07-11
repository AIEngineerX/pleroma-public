import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
  commitOffering, insertOffering, offeringBySha, offeringStatusById, pendingOfferings, publishPerception,
  setOfferingStatus,
} from "../src/db";
import { applyMigrations } from "./helpers";

beforeAll(() => applyMigrations(env.DB));

describe("offerings repository", () => {
  it("inserts, finds by sha, lists pending, updates status", async () => {
    const row = {
      id: "01TEST", wallet: "walletA", sig: "sigA", image_key: "off/01TEST.png",
      sha256: "abc123", status: "pending" as const, attempts: 0,
      created_at: Date.now(), perceived_at: null,
    };
    await insertOffering(env.DB, row);
    expect((await offeringBySha(env.DB, "abc123"))?.id).toBe("01TEST");
    expect((await pendingOfferings(env.DB, 10)).map(o => o.id)).toContain("01TEST");
    await setOfferingStatus(env.DB, "01TEST", "perceivable");
    expect((await offeringBySha(env.DB, "abc123"))?.status).toBe("perceivable");
  });

  it("setOfferingStatus with a matching expectedStatus performs the transition and returns true", async () => {
    const id = "01CAS-MATCH";
    await insertOffering(env.DB, { id, wallet: null, sig: null, image_key: `offerings/${id}`,
      sha256: "cas-match-sha", status: "pending", attempts: 0, created_at: Date.now(), perceived_at: null });

    const won = await setOfferingStatus(env.DB, id, "perceivable", { expectedStatus: "pending" });
    expect(won).toBe(true);

    const row = await offeringBySha(env.DB, "cas-match-sha");
    expect(row?.status).toBe("perceivable");
  });

  it("setOfferingStatus with a non-matching expectedStatus (the resurrection guard) returns false and leaves the row UNCHANGED", async () => {
    const id = "01CAS-NOMATCH";
    await insertOffering(env.DB, { id, wallet: null, sig: null, image_key: `offerings/${id}`,
      sha256: "cas-nomatch-sha", status: "rejected", attempts: 0, created_at: Date.now(), perceived_at: null });

    // A stale tick tries to promote a row another tick already rejected.
    const won = await setOfferingStatus(env.DB, id, "perceivable", { expectedStatus: "pending" });
    expect(won).toBe(false);

    const row = await offeringBySha(env.DB, "cas-nomatch-sha");
    expect(row?.status).toBe("rejected"); // unchanged — never resurrected
  });

  it("setOfferingStatus without expectedStatus is an unconditional update and returns true", async () => {
    const id = "01CAS-UNCONDITIONAL";
    await insertOffering(env.DB, { id, wallet: null, sig: null, image_key: `offerings/${id}`,
      sha256: "cas-unconditional-sha", status: "rejected", attempts: 0, created_at: Date.now(), perceived_at: null });

    const won = await setOfferingStatus(env.DB, id, "failed");
    expect(won).toBe(true);

    const row = await offeringBySha(env.DB, "cas-unconditional-sha");
    expect(row?.status).toBe("failed");
  });

  it("offeringStatusById returns the row's current status, and null for an absent id", async () => {
    const id = "01STATUS-BY-ID";
    await insertOffering(env.DB, { id, wallet: null, sig: null, image_key: `offerings/${id}`,
      sha256: "status-by-id-sha", status: "pending", attempts: 0, created_at: Date.now(), perceived_at: null });

    expect(await offeringStatusById(env.DB, id)).toBe("pending");

    await setOfferingStatus(env.DB, id, "rejected");
    expect(await offeringStatusById(env.DB, id)).toBe("rejected");

    expect(await offeringStatusById(env.DB, "no-such-offering")).toBeNull();
  });

  it("publishPerception atomically flips perceivable->perceived and inserts the transcript exactly once", async () => {
    const id = "01PUBLISH";
    await insertOffering(env.DB, {
      id, wallet: null, sig: null, image_key: `offerings/${id}`,
      sha256: "publish-sha", status: "perceivable", attempts: 0,
      created_at: Date.now(), perceived_at: null,
    });

    const first = await publishPerception(env.DB, {
      offeringId: id, transcriptId: "01TXA", verse: "v1", at: Date.now(),
    });
    expect(first).toBe(true);

    // Re-run against the now-perceived row: the WHERE EXISTS guard means neither statement
    // in the batch fires — no second transcript, and the return value proves it took no action.
    const second = await publishPerception(env.DB, {
      offeringId: id, transcriptId: "01TXB", verse: "v2", at: Date.now(),
    });
    expect(second).toBe(false);

    const row = await env.DB.prepare(`SELECT status FROM offerings WHERE id = ?1`)
      .bind(id).first<{ status: string }>();
    expect(row?.status).toBe("perceived");
    const count = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM transcripts WHERE offering_id = ?1`
    ).bind(id).first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("commitOffering atomically inserts the offering and bumps the wallet's offering_count exactly once", async () => {
    const wallet = "wallet-commit-1";
    const row = {
      id: "01COMMIT1", wallet, sig: "sig1", image_key: "quarantine/01COMMIT1",
      sha256: "commit-sha-1", status: "pending" as const, attempts: 0,
      created_at: Date.now(), perceived_at: null, nonce: "nonce-1",
    };
    await commitOffering(env.DB, row, wallet);

    expect((await offeringBySha(env.DB, "commit-sha-1"))?.id).toBe("01COMMIT1");
    const walletRow = await env.DB.prepare(`SELECT offering_count FROM wallets WHERE address = ?1`)
      .bind(wallet).first<{ offering_count: number }>();
    expect(walletRow?.offering_count).toBe(1);
  });

  it("commitOffering rolls back the wallet bump when the insert UNIQUE-violates: the count never drifts from the committed offering", async () => {
    const wallet = "wallet-commit-2";
    const row1 = {
      id: "01COMMIT2A", wallet, sig: "sig2", image_key: "quarantine/01COMMIT2A",
      sha256: "commit-sha-2", status: "pending" as const, attempts: 0,
      created_at: Date.now(), perceived_at: null, nonce: "nonce-2",
    };
    await commitOffering(env.DB, row1, wallet);

    // Same sha256 -> the insert's UNIQUE(sha256) constraint fires inside the batch.
    const row2 = { ...row1, id: "01COMMIT2B", image_key: "quarantine/01COMMIT2B", nonce: "nonce-2b" };
    await expect(commitOffering(env.DB, row2, wallet)).rejects.toThrow();

    const walletRow = await env.DB.prepare(`SELECT offering_count FROM wallets WHERE address = ?1`)
      .bind(wallet).first<{ offering_count: number }>();
    // db.batch() runs as one D1 transaction: the offering insert's UNIQUE(sha256) violation
    // rolls back the wallet bump too, so the count reflects only the first committed offering.
    expect(walletRow?.offering_count).toBe(1);
    // And no second offering row was created.
    const offeringCount = await env.DB.prepare(`SELECT COUNT(*) AS n FROM offerings WHERE id = ?1`)
      .bind("01COMMIT2B").first<{ n: number }>();
    expect(offeringCount?.n).toBe(0);
  });
});
