import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { runEyeBatch, selectForPerception } from "../src/eye";
import { insertOffering, type OfferingRow } from "../src/db";
import { applyMigrations } from "./helpers";

beforeAll(() => applyMigrations(env.DB));

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
});
