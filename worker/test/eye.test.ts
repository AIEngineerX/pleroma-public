import { env } from "cloudflare:test";
import { ulid } from "ulid";
import { beforeAll, describe, expect, it } from "vitest";
import { runEyeBatch, selectForPerception, promoteFromQuarantine } from "../src/eye";
import { addTranscript, claimPerceived, insertOffering, type OfferingRow } from "../src/db";
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
  it("claimPerceived flips perceivable->perceived exactly once; a re-run on an already-perceived offering cannot re-claim it", async () => {
    const id = "idempotent-perceive-me";
    await insertOffering(env.DB, { id, wallet: null, sig: null,
      image_key: `offerings/${id}`, sha256: id, status: "perceivable",
      attempts: 0, created_at: Date.now(), perceived_at: null });

    // First attempt: claims the row and (per the guard) publishes the transcript.
    expect(await claimPerceived(env.DB, id)).toBe(true);
    await addTranscript(env.DB, { id: ulid(), organ: "EYE", register: "verse",
      text: "first verse", offering_id: id, rite_id: null, created_at: Date.now() });

    // Simulated re-run (e.g. a retry after a downstream failure elsewhere): status is no
    // longer 'perceivable', so the claim fails and — per the guard — no second transcript
    // is ever inserted, preventing the double-publish the old insert-then-update order allowed.
    expect(await claimPerceived(env.DB, id)).toBe(false);

    const row = await env.DB.prepare(`SELECT status FROM offerings WHERE id = ?1`)
      .bind(id).first<{ status: string }>();
    expect(row?.status).toBe("perceived");
    const count = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM transcripts WHERE organ = 'EYE' AND offering_id = ?1`
    ).bind(id).first<{ n: number }>();
    expect(count?.n).toBe(1);
  });
});
