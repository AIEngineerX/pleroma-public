import { env } from "cloudflare:test";
import { ulid } from "ulid";
import { beforeAll, describe, expect, it } from "vitest";
import { runEyeBatch, selectForPerception, promoteFromQuarantine, sweepQuarantine, parseVerse } from "../src/eye";
import { insertOffering, publishPerception, type OfferingRow } from "../src/db";
import { applyMigrations } from "./helpers";

beforeAll(() => applyMigrations(env.DB));

const PNG = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
), c => c.charCodeAt(0));

function off(id: string, wallet: string | null): OfferingRow {
  return { id, wallet, sig: null, image_key: `offerings/${id}.png`, sha256: id,
    status: "perceivable", attempts: 0, created_at: 0, perceived_at: null };
}

describe("selectForPerception", () => {
  it("caps the batch at 12 and always includes attended wallets", () => {
    const attended = new Set(["holderA"]);
    const candidates = [off("h1", "holderA"), ...Array.from({ length: 20 }, (_, i) => off(`n${i}`, `w${i}`))];
    const picked = selectForPerception(candidates, attended, 0, 0, () => 0.5);
    expect(picked.length).toBe(12);
    expect(picked.map(o => o.id)).toContain("h1");
  });

  it("stops selecting non-holders at the 60/day cap", () => {
    const candidates = Array.from({ length: 12 }, (_, i) => off(`n${i}`, `w${i}`));
    const picked = selectForPerception(candidates, new Set(), 60, 60, () => 0.5);
    expect(picked.length).toBe(0);
  });

  it("stops everything at the 200/day global cap", () => {
    const candidates = [off("h1", "holderA")];
    const picked = selectForPerception(candidates, new Set(["holderA"]), 0, 200, () => 0.5);
    expect(picked.length).toBe(0);
  });

  it("shuffles non-holders with Fisher-Yates driven by the injected rand", () => {
    // Hand-computed Fisher-Yates on [n0..n4] with rand sequence [0.9, 0.1, 0.5, 0.3]:
    // i=4: j=floor(0.9*5)=4 (no-op)          -> [n0,n1,n2,n3,n4]
    // i=3: j=floor(0.1*4)=0 swap(3,0)        -> [n3,n1,n2,n0,n4]
    // i=2: j=floor(0.5*3)=1 swap(2,1)        -> [n3,n2,n1,n0,n4]
    // i=1: j=floor(0.3*2)=0 swap(1,0)        -> [n2,n3,n1,n0,n4]
    const seq = [0.9, 0.1, 0.5, 0.3];
    let calls = 0;
    const rand = () => seq[calls++];
    const candidates = Array.from({ length: 5 }, (_, i) => off(`n${i}`, `w${i}`));
    const picked = selectForPerception(candidates, new Set(), 0, 0, rand);
    expect(picked.map(o => o.id)).toEqual(["n2", "n3", "n1", "n0", "n4"]);
    expect(calls).toBe(4); // exactly n-1 draws, one per Fisher-Yates step
  });
});

// C2's happy path (EYE returning a well-formed {"verse":...} JSON body) can't be driven through
// runEyeBatch/askMind in this suite without a real ANTHROPIC_API_KEY — there is no live key
// configured, so any askMind() call in the integration harness hits the real network and fails
// with a transport/auth error before ever reaching the verse-parsing code. Per the fix-wave
// deviation note, the validation+rejection contract is exercised directly against the extracted
// pure helper instead (the live suite covers the true happy path against the real API).
describe("parseVerse", () => {
  it("throws when the model response has no verse field, a non-string verse, or a blank verse", () => {
    expect(() => parseVerse(JSON.stringify({}))).toThrow();
    expect(() => parseVerse(JSON.stringify({ verse: 42 }))).toThrow();
    expect(() => parseVerse(JSON.stringify({ verse: "   " }))).toThrow();
  });

  it("throws on unparseable JSON", () => {
    expect(() => parseVerse("not json")).toThrow();
  });

  it("passes through a verse at or under the 40-word contract unchanged (aside from trimming)", () => {
    expect(parseVerse(JSON.stringify({ verse: "  a quiet verse  " }))).toBe("a quiet verse");
    const exactlyForty = Array.from({ length: 40 }, (_, i) => `w${i}`).join(" ");
    expect(parseVerse(JSON.stringify({ verse: exactlyForty }))).toBe(exactlyForty);
  });

  it("throws on a verse over the 40-word contract instead of truncating it — a transcript published as scripture must be genuine and unedited", () => {
    const fortyOneWords = Array.from({ length: 41 }, (_, i) => `w${i}`).join(" ");
    expect(() => parseVerse(JSON.stringify({ verse: fortyOneWords }))).toThrow(/40-word contract/);
  });
});

describe("runEyeBatch", () => {
  it("fails a perceivable offering whose relic is missing from R2 and leaves a PRIEST trail", async () => {
    const id = "missing-relic";
    await insertOffering(env.DB, { id, wallet: null, sig: null,
      image_key: `offerings/${id}.png`, sha256: id, status: "perceivable",
      attempts: 0, created_at: Date.now(), perceived_at: null });
    const n = await runEyeBatch(env); // no R2 object -> fast-fail path, never reaches askMind
    expect(n).toBe(0);
    const row = await env.DB.prepare(`SELECT status FROM offerings WHERE id = ?1`)
      .bind(id).first<{ status: string }>();
    expect(row?.status).toBe("failed");
    const note = await env.DB.prepare(
      `SELECT text FROM transcripts WHERE organ = 'PRIEST' AND register = 'system' AND offering_id = ?1`
    ).bind(id).first<{ text: string }>();
    expect(note?.text).toContain(id);
  });

  it("stops immediately when the deadline has already passed, before touching any item", async () => {
    const pendingId = "deadline-pending";
    const perceivableId = "deadline-perceivable";
    await insertOffering(env.DB, { id: pendingId, wallet: null, sig: null,
      image_key: `offerings/${pendingId}.png`, sha256: pendingId, status: "pending",
      attempts: 0, created_at: Date.now(), perceived_at: null });
    await insertOffering(env.DB, { id: perceivableId, wallet: null, sig: null,
      image_key: `offerings/${perceivableId}.png`, sha256: perceivableId, status: "perceivable",
      attempts: 0, created_at: Date.now(), perceived_at: null });

    const n = await runEyeBatch(env, Date.now() - 1_000); // deadline already in the past
    expect(n).toBe(0);

    // Neither item was touched at all — proves the loop broke before the first iteration's
    // R2 get / moderate / askMind, not merely that it failed a call.
    const pendingRow = await env.DB.prepare(`SELECT status FROM offerings WHERE id = ?1`)
      .bind(pendingId).first<{ status: string }>();
    expect(pendingRow?.status).toBe("pending");
    const perceivableRow = await env.DB.prepare(`SELECT status FROM offerings WHERE id = ?1`)
      .bind(perceivableId).first<{ status: string }>();
    expect(perceivableRow?.status).toBe("perceivable");
  });

  it("promotes an allowed offering from quarantine/ to offerings/ and updates image_key", async () => {
    const id = "promote-me";
    await env.RELICS.put(`quarantine/${id}`, PNG, { httpMetadata: { contentType: "image/webp" } });
    await insertOffering(env.DB, { id, wallet: null, sig: null,
      image_key: `quarantine/${id}`, sha256: id, status: "pending", media_type: "image/webp",
      attempts: 0, created_at: Date.now(), perceived_at: null });
    const row = (await env.DB.prepare(`SELECT * FROM offerings WHERE id = ?1`)
      .bind(id).first<OfferingRow>())!;

    await promoteFromQuarantine(env, row);

    const promoted = await env.RELICS.get(`offerings/${id}`);
    // The uploaded media type round-trips through the R2 object's content-type, not just
    // the offerings.media_type DB column.
    expect(promoted?.httpMetadata?.contentType).toBe("image/webp");
    expect(promoted).not.toBeNull();
    await promoted?.arrayBuffer();
    expect(await env.RELICS.get(`quarantine/${id}`)).toBeNull();
    const updated = await env.DB.prepare(`SELECT image_key FROM offerings WHERE id = ?1`)
      .bind(id).first<{ image_key: string }>();
    expect(updated?.image_key).toBe(`offerings/${id}`);
  });

  it("promoteFromQuarantine is idempotent across a repeated call, e.g. a retry after a lost D1 response", async () => {
    const id = "promote-idempotent";
    await env.RELICS.put(`quarantine/${id}`, PNG, { httpMetadata: { contentType: "image/png" } });
    await insertOffering(env.DB, { id, wallet: null, sig: null,
      image_key: `quarantine/${id}`, sha256: id, status: "pending",
      attempts: 0, created_at: Date.now(), perceived_at: null });
    const row = (await env.DB.prepare(`SELECT * FROM offerings WHERE id = ?1`)
      .bind(id).first<OfferingRow>())!;

    await promoteFromQuarantine(env, row);
    // Re-fetch: image_key now reflects the permanent key, as a retry driven by a fresh D1 query
    // (e.g. the next tick's pendingOfferings) would see it.
    const afterFirst = (await env.DB.prepare(`SELECT * FROM offerings WHERE id = ?1`)
      .bind(id).first<OfferingRow>())!;
    expect(afterFirst.image_key).toBe(`offerings/${id}`);

    // A second call — simulating a retry that re-runs promotion against the already-promoted
    // row — must not throw and must not destroy the object it just re-affirmed.
    await expect(promoteFromQuarantine(env, afterFirst)).resolves.not.toThrow();

    const finalRow = await env.DB.prepare(`SELECT image_key FROM offerings WHERE id = ?1`)
      .bind(id).first<{ image_key: string }>();
    expect(finalRow?.image_key).toBe(`offerings/${id}`);
    const promoted = await env.RELICS.get(`offerings/${id}`);
    expect(promoted).not.toBeNull();
    await promoted?.arrayBuffer();
  });

  it("purges the quarantine object when a pending offering is rejected", async () => {
    const id = "reject-purge-me";
    await env.RELICS.put(`quarantine/${id}`, PNG);
    await insertOffering(env.DB, { id, wallet: null, sig: null,
      image_key: `quarantine/${id}`, sha256: id, status: "pending",
      attempts: 0, created_at: Date.now(), perceived_at: null });

    // No valid ANTHROPIC_API_KEY in this suite, so moderate() fails closed to reject —
    // deterministically exercises the reject/purge branch without a live LLM call.
    await runEyeBatch(env);

    const row = await env.DB.prepare(`SELECT status, image_key FROM offerings WHERE id = ?1`)
      .bind(id).first<{ status: string; image_key: string }>();
    expect(row?.status).toBe("rejected");
    expect(await env.RELICS.get(`quarantine/${id}`)).toBeNull();
    expect(await env.RELICS.get(`offerings/${id}`)).toBeNull();
  });
});

describe("EYE publish idempotency", () => {
  it("publishPerception flips perceivable->perceived and publishes the transcript exactly once in one atomic batch; a re-run is a clean no-op", async () => {
    const id = "idempotent-perceive-me";
    await insertOffering(env.DB, { id, wallet: null, sig: null,
      image_key: `offerings/${id}`, sha256: id, status: "perceivable",
      attempts: 0, created_at: Date.now(), perceived_at: null });

    // First call: claim + transcript insert commit together in one D1 batch.
    expect(await publishPerception(env.DB, {
      offeringId: id, transcriptId: ulid(), verse: "first verse", at: Date.now(),
    })).toBe(true);

    // Simulated re-run (e.g. a retry after the client observed an error even though the
    // batch had already committed server-side): status is no longer 'perceivable', so both
    // statements in the batch are no-ops — no second transcript, preventing the double-publish
    // the old claim-then-insert-as-separate-writes order allowed.
    expect(await publishPerception(env.DB, {
      offeringId: id, transcriptId: ulid(), verse: "second verse", at: Date.now(),
    })).toBe(false);

    const row = await env.DB.prepare(`SELECT status FROM offerings WHERE id = ?1`)
      .bind(id).first<{ status: string }>();
    expect(row?.status).toBe("perceived");
    const count = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM transcripts WHERE organ = 'EYE' AND offering_id = ?1`
    ).bind(id).first<{ n: number }>();
    expect(count?.n).toBe(1);
  });
});

describe("sweepQuarantine", () => {
  it("deletes only stale quarantine/ objects, never touches offerings/, and returns the count deleted", async () => {
    await env.RELICS.put("quarantine/stale-1", PNG);
    await env.RELICS.put("offerings/untouched", PNG);

    // R2 doesn't let us backdate an object's `uploaded` time, so drive the sweep with a `now`
    // far enough in the future that a freshly-put object reads as older than the 24h TTL.
    const future = Date.now() + 25 * 60 * 60_000;
    const deleted = await sweepQuarantine(env, future);
    expect(deleted).toBe(1);

    expect(await env.RELICS.get("quarantine/stale-1")).toBeNull();
    const untouched = await env.RELICS.get("offerings/untouched");
    expect(untouched).not.toBeNull();
    await untouched?.arrayBuffer();
  });

  it("does not delete a fresh quarantine/ object when swept at the current time", async () => {
    await env.RELICS.put("quarantine/fresh-1", PNG);
    const deleted = await sweepQuarantine(env, Date.now());
    expect(deleted).toBe(0);
    const fresh = await env.RELICS.get("quarantine/fresh-1");
    expect(fresh).not.toBeNull();
    await fresh?.arrayBuffer();
  });

  it("is bounded by deadlineMs: an already-past deadline deletes nothing even when aged objects exist", async () => {
    await env.RELICS.put("quarantine/stale-bounded", PNG);
    // `now` (the TTL-comparison clock) is far enough in the future for the object to read as
    // aged, but `deadlineMs` is checked against the REAL wall clock (Date.now()) and is already
    // in the past, so the loop must break before ever listing/deleting anything.
    const now = Date.now() + 25 * 60 * 60_000;
    const deleted = await sweepQuarantine(env, now, Date.now() - 1);
    expect(deleted).toBe(0);
    const stillThere = await env.RELICS.get("quarantine/stale-bounded");
    expect(stillThere).not.toBeNull();
    await stillThere?.arrayBuffer();
  });

  it("is bounded by maxDeletes: caps the number of stale objects deleted in one call", async () => {
    for (let i = 0; i < 5; i++) await env.RELICS.put(`quarantine/cap-${i}`, PNG);
    const future = Date.now() + 25 * 60 * 60_000; // all 5 objects read as aged
    const deleted = await sweepQuarantine(env, future, future + 90_000, 3);
    expect(deleted).toBe(3);
    const remaining = await env.RELICS.list({ prefix: "quarantine/cap-" });
    expect(remaining.objects.length).toBe(2);
  });
});
