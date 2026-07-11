import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
  insertOffering, offeringBySha, pendingOfferings, publishPerception, setOfferingStatus,
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
});
