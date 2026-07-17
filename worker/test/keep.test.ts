import { env } from "cloudflare:test";
import { ulid } from "ulid";
import { beforeAll, describe, expect, it } from "vitest";
import { selectForKeeping } from "../src/keep";
import {
  commitVerdict, insertRelic, recentRelicSummaries, walletHistory, relicsKeptToday,
  insertOffering, type OfferingRow,
} from "../src/db";
import { applyMigrations } from "./helpers";
import { dayKey } from "../src/budget";

beforeAll(() => applyMigrations(env.DB));

function off(id: string, wallet: string | null): OfferingRow {
  return { id, wallet, sig: null, image_key: `offerings/${id}`, sha256: id,
    status: "perceived", attempts: 0, created_at: 0, perceived_at: 1 };
}

describe("KEEP selection (holder-weighted ordering; never silently drops a candidate)", () => {
  it("puts attended offerings first, but returns every perceived candidate for judgment", () => {
    const attended = new Set(["holderA", "holderB"]);
    const perceived = [
      off("n1", "w1"), off("h1", "holderA"), off("n2", "w2"), off("h2", "holderB"), off("n3", "w3"),
    ];
    const picked = selectForKeeping(perceived, attended);
    expect(picked.slice(0, 2).map(o => o.id).sort()).toEqual(["h1", "h2"]); // attended first
    expect(picked.length).toBe(5); // every perceived candidate remains eligible for judgment
  });

  it("never truncates the candidate list, even far past the historical ~12/day figure", () => {
    // Regression guard for the bug this fixes: selectForKeeping used to slice to
    // (KEEP_DAILY - keptSoFarToday), so most witnessed marks on a busy day were never looked at by
    // KEEP at all -- not "mostly mourned", simply never judged. The daily pace is now the model's
    // own informed judgment (see runKeep's prompt), never a code-level cutoff on who gets seen.
    const perceived = Array.from({ length: 40 }, (_, i) => off(`n${i}`, `w${i}`));
    expect(selectForKeeping(perceived, new Set()).length).toBe(40);
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

describe("verdict atomicity (single transactional batch)", () => {
  it("rolls the whole verdict back when the relic insert fails: the offering stays perceived, with no verdict transcript and no relic — never a claimed keep with nothing behind it", async () => {
    const id = "atomic-keep";
    await insertOffering(env.DB, { id, wallet: null, sig: null, image_key: `offerings/${id}`,
      sha256: id, status: "perceived", attempts: 0, created_at: Date.now(), perceived_at: Date.now() });

    // Force the relic INSERT inside commitVerdict's batch to abort (the same forced-abort trigger
    // technique offerings.test.ts uses). db.batch() is one transaction, so the guarded status UPDATE
    // and the already-inserted verdict transcript must roll back with it — proving atomicity, not
    // merely that the relic was skipped. vitest-pool-workers isolates D1 per it(), so the trigger
    // cannot leak; it is also dropped explicitly below.
    await env.DB.exec(
      `CREATE TRIGGER force_relic_fail BEFORE INSERT ON relics BEGIN SELECT RAISE(ABORT, 'forced test failure'); END`
    );
    await expect(commitVerdict(env.DB, {
      offeringId: id, verdict: "kept", summary: "a kept mark",
      transcriptId: ulid(), relicId: ulid(), wallet: null, riteId: "2026-07-12", at: Date.now(),
    })).rejects.toThrow();
    await env.DB.exec(`DROP TRIGGER force_relic_fail`);

    // The CAS never committed: still perceived (a clean retry next rite), and neither the verdict
    // transcript nor the relic exists — the exact orphan the atomic batch prevents.
    const row = await env.DB.prepare(`SELECT status FROM offerings WHERE id = ?1`).bind(id).first<{ status: string }>();
    expect(row?.status).toBe("perceived");
    const tx = await env.DB.prepare(`SELECT COUNT(*) AS n FROM transcripts WHERE organ = 'KEEP' AND offering_id = ?1`)
      .bind(id).first<{ n: number }>();
    expect(tx?.n).toBe(0);
    const relic = await env.DB.prepare(`SELECT COUNT(*) AS n FROM relics WHERE offering_id = ?1`)
      .bind(id).first<{ n: number }>();
    expect(relic?.n).toBe(0);
  });

  it("commits transcript + relic + transition together on a clean keep, and a rite re-run is a no-op (idempotent, no duplicate relic)", async () => {
    const id = "atomic-keep-ok";
    await insertOffering(env.DB, { id, wallet: "w-atomic", sig: null, image_key: `offerings/${id}`,
      sha256: id, status: "perceived", attempts: 0, created_at: Date.now(), perceived_at: Date.now() });

    const won = await commitVerdict(env.DB, {
      offeringId: id, verdict: "kept", summary: "a bright coil",
      transcriptId: ulid(), relicId: ulid(), wallet: "w-atomic", riteId: "2026-07-12", at: Date.now(),
    });
    expect(won).toBe(true);
    expect((await env.DB.prepare(`SELECT status FROM offerings WHERE id = ?1`).bind(id).first<{ status: string }>())?.status).toBe("kept");
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM relics WHERE offering_id = ?1`).bind(id).first<{ n: number }>())?.n).toBe(1);
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM transcripts WHERE organ = 'KEEP' AND offering_id = ?1`).bind(id).first<{ n: number }>())?.n).toBe(1);

    // Re-run against the now-kept row: the guarded UPDATE matches nothing, so it returns false and
    // writes no second transcript or relic.
    const again = await commitVerdict(env.DB, {
      offeringId: id, verdict: "kept", summary: "a bright coil",
      transcriptId: ulid(), relicId: ulid(), wallet: "w-atomic", riteId: "2026-07-12", at: Date.now(),
    });
    expect(again).toBe(false);
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM relics WHERE offering_id = ?1`).bind(id).first<{ n: number }>())?.n).toBe(1);
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM transcripts WHERE organ = 'KEEP' AND offering_id = ?1`).bind(id).first<{ n: number }>())?.n).toBe(1);
  });

  it("a mourn flips perceived->mourned with a verdict transcript but no relic", async () => {
    const id = "atomic-mourn";
    await insertOffering(env.DB, { id, wallet: null, sig: null, image_key: `offerings/${id}`,
      sha256: id, status: "perceived", attempts: 0, created_at: Date.now(), perceived_at: Date.now() });

    const won = await commitVerdict(env.DB, {
      offeringId: id, verdict: "mourned", summary: "it was already fading",
      transcriptId: ulid(), relicId: ulid(), wallet: null, riteId: "2026-07-12", at: Date.now(),
    });
    expect(won).toBe(true);
    expect((await env.DB.prepare(`SELECT status FROM offerings WHERE id = ?1`).bind(id).first<{ status: string }>())?.status).toBe("mourned");
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM relics WHERE offering_id = ?1`).bind(id).first<{ n: number }>())?.n).toBe(0);
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM transcripts WHERE organ = 'KEEP' AND offering_id = ?1`).bind(id).first<{ n: number }>())?.n).toBe(1);
  });
});
