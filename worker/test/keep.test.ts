import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { selectForKeeping } from "../src/keep";
import {
  insertRelic, recentRelicSummaries, walletHistory, relicsKeptToday,
  insertOffering, type OfferingRow,
} from "../src/db";
import { applyMigrations } from "./helpers";
import { dayKey } from "../src/budget";

beforeAll(() => applyMigrations(env.DB));

function off(id: string, wallet: string | null): OfferingRow {
  return { id, wallet, sig: null, image_key: `offerings/${id}`, sha256: id,
    status: "perceived", attempts: 0, created_at: 0, perceived_at: 1 };
}

describe("KEEP selection (holder-weighted, <=12/day)", () => {
  it("puts attended offerings first and caps at the remaining daily room", () => {
    const attended = new Set(["holderA", "holderB"]);
    const perceived = [
      off("n1", "w1"), off("h1", "holderA"), off("n2", "w2"), off("h2", "holderB"), off("n3", "w3"),
    ];
    const picked = selectForKeeping(perceived, attended, 0);
    expect(picked.slice(0, 2).map(o => o.id).sort()).toEqual(["h1", "h2"]); // attended first
    expect(picked.length).toBe(5);
  });

  it("respects the 12/day cap given what was already kept today", () => {
    const perceived = Array.from({ length: 10 }, (_, i) => off(`n${i}`, `w${i}`));
    expect(selectForKeeping(perceived, new Set(), 8).length).toBe(4); // 12 - 8
    expect(selectForKeeping(perceived, new Set(), 12).length).toBe(0);
  });
});

describe("Reliquary repo", () => {
  it("inserts relics and reads recent summaries newest-first and the daily count", async () => {
    await insertRelic(env.DB, { id: "r1", offering_id: "o1", wallet: "w1", summary: "a small sun",
      rite_id: "2026-07-12", kept_at: Date.now() - 2000, genesis: 0, accreted_at: null });
    await insertRelic(env.DB, { id: "r2", offering_id: "o2", wallet: "w2", summary: "a folded bird",
      rite_id: "2026-07-12", kept_at: Date.now(), genesis: 0, accreted_at: null });
    const sums = await recentRelicSummaries(env.DB, 50);
    expect(sums[0]).toBe("a folded bird");
    expect(sums).toContain("a small sun");
    expect(await relicsKeptToday(env.DB, dayKey())).toBeGreaterThanOrEqual(2);
  });

  it("reports a wallet's history including kept count and attended flag", async () => {
    await insertOffering(env.DB, { id: "wh1", wallet: "histW", sig: null, image_key: "offerings/wh1",
      sha256: "wh1", status: "kept", attempts: 0, created_at: Date.now(), perceived_at: Date.now() });
    await env.DB.prepare(`INSERT INTO wallets (address, first_seen, offering_count, attended) VALUES (?1, ?2, 1, 1)`)
      .bind("histW", Date.now()).run();
    await insertRelic(env.DB, { id: "rwh", offering_id: "wh1", wallet: "histW", summary: "kept mark",
      rite_id: null, kept_at: Date.now(), genesis: 0, accreted_at: null });
    const h = await walletHistory(env.DB, "histW");
    expect(h.attended).toBe(true);
    expect(h.kept_count).toBeGreaterThanOrEqual(1);
  });
});

describe("runKeep dead paths (no live key)", () => {
  it("leaves a perceived offering perceived when the mind is unreachable, never fabricating a verdict", async () => {
    const { runKeep } = await import("../src/keep");
    await insertOffering(env.DB, { id: "keep-nokey", wallet: null, sig: null, image_key: "offerings/keep-nokey",
      sha256: "keep-nokey", status: "perceived", attempts: 0, created_at: Date.now(), perceived_at: Date.now() });
    await env.DB.prepare(`INSERT INTO transcripts (id, organ, register, text, offering_id, rite_id, created_at)
      VALUES ('t-nokey','EYE','verse','a mark', 'keep-nokey', NULL, ?1)`).bind(Date.now()).run();
    const kept = await runKeep(env, "2026-07-12"); // askMind fails without a key -> no verdict
    expect(kept).toBe(0);
    const row = await env.DB.prepare(`SELECT status FROM offerings WHERE id = 'keep-nokey'`).first<{ status: string }>();
    expect(row?.status).toBe("perceived"); // never invented a keep/mourn
  });
});
