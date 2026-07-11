import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { insertOffering, offeringBySha, pendingOfferings, setOfferingStatus } from "../src/db";
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
});
