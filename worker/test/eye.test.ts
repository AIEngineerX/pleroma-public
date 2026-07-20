import { env } from "cloudflare:test";
import { ulid } from "ulid";
import { beforeAll, describe, expect, it } from "vitest";
import {
  reconcileBacklogAlerts, runEyeBatch, selectForPerception, promoteFromQuarantine, sweepQuarantine, parseVerse,
  captureLine,
} from "../src/eye";
import {
  insertOffering, offeringStatusById, publishPerception, setOfferingStatus, type OfferingRow,
} from "../src/db";
import type { GestureMeta } from "../src/offerings";
import { activeAlerts } from "../src/alert";
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

  it("selects nothing in a tick once the ~200/day per-tick ceiling is already reached", () => {
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

  it("tolerates a code-fenced but otherwise valid response — a formatting quirk must not dead-letter a genuine offering", () => {
    expect(parseVerse('```json\n{"verse":"a quiet verse"}\n```')).toBe("a quiet verse");
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

// Task 6 (grown-lineage-marks): captureLine is built ENTIRELY from the clamped gesture struct,
// worker-side -- these fixtures pin the brief's exact wording contract.
describe("captureLine", () => {
  const base: GestureMeta = {
    holdMs: 1200, travelPx: 40, tremorAmp: 0.4, knockSig: [],
    approachSpreadPx: 120, pigmentIntensity: 0.6, substrateRelicId: null, substrateOwn: false,
  };

  it("renders a plain hold with faint tremor and no lineage clause", () => {
    expect(captureLine(base)).toBe("Captured with the mark: a 1.2s hold, faint tremor.");
  });

  it("renders a knock as 'knock of N+1 beats' where N is knockSig.length", () => {
    expect(captureLine({ ...base, knockSig: [3, 5, 2] })).toBe(
      "Captured with the mark: a 1.2s knock of 4 beats, faint tremor."
    );
  });

  it("renders 'strong' tremor once tremorAmp exceeds 1, 'faint' at or below it", () => {
    expect(captureLine({ ...base, tremorAmp: 1 })).toContain("faint tremor");
    expect(captureLine({ ...base, tremorAmp: 1.01 })).toContain("strong tremor");
  });

  it("appends the lineage clause only when substrateRelicId is present", () => {
    expect(captureLine({ ...base, substrateRelicId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" })).toBe(
      "Captured with the mark: a 1.2s hold, faint tremor, grown on the residue of a kept relic."
    );
    expect(captureLine(base)).not.toContain("residue");
  });

  it("formats holdMs to one decimal of seconds", () => {
    expect(captureLine({ ...base, holdMs: 0 })).toContain("0.0s");
    expect(captureLine({ ...base, holdMs: 20_000 })).toContain("20.0s");
    expect(captureLine({ ...base, holdMs: 1660 })).toContain("1.7s"); // toFixed rounding
  });

  it("combines a strong-tremor knock grown on a kept relic in one line", () => {
    expect(captureLine({ ...base, knockSig: [1], tremorAmp: 2, substrateRelicId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" })).toBe(
      "Captured with the mark: a 1.2s knock of 2 beats, strong tremor, grown on the residue of a kept relic."
    );
  });
});

describe("moderation while the budget sleeps", () => {
  it("releases the claimed row back to pending with no attempts strike, instead of stranding it in 'moderating'", async () => {
    const id = "asleep-release";
    await insertOffering(env.DB, { id, wallet: null, sig: null,
      image_key: `quarantine/${id}`, sha256: id, status: "pending",
      attempts: 0, created_at: Date.now(), perceived_at: null });
    await env.RELICS.put(`quarantine/${id}`, PNG);
    // Drain the organ budget so moderate() -> askMind throws MindAsleepError at the reservation.
    await env.DB.prepare(`INSERT INTO config (key, value) VALUES ('cap:llm', '0')
      ON CONFLICT(key) DO UPDATE SET value = '0'`).run();
    try {
      expect(await runEyeBatch(env)).toBe(0);
      const row = await env.DB.prepare(`SELECT status, attempts FROM offerings WHERE id = ?1`)
        .bind(id).first<{ status: string; attempts: number }>();
      expect(row?.status).toBe("pending"); // immediately re-claimable when the budget resets
      expect(row?.attempts).toBe(0);       // an asleep mind is never the offering's fault
    } finally {
      await env.DB.prepare(`DELETE FROM config WHERE key = 'cap:llm'`).run();
    }
  });
});

describe("reconcileBacklogAlerts — saturation in the later queue stages is operator-visible", () => {
  it("alerts on aged perceivable and perceived backlogs, and clears both once they drain", async () => {
    const now = Date.parse("2026-08-10T12:00:00Z");
    await insertOffering(env.DB, { id: "backlog-perceivable", wallet: null, sig: null,
      image_key: "quarantine/backlog-perceivable", sha256: "backlog-perceivable", status: "perceivable",
      attempts: 0, created_at: now - 3 * 60 * 60_000, perceived_at: null });
    await insertOffering(env.DB, { id: "backlog-perceived", wallet: null, sig: null,
      image_key: "offerings/backlog-perceived", sha256: "backlog-perceived", status: "perceived",
      attempts: 0, created_at: now - 60 * 60 * 60_000, perceived_at: now - 50 * 60 * 60_000 });
    await reconcileBacklogAlerts(env, now);
    const alerts = await activeAlerts(env.DB);
    expect(alerts).toContain("perception_backlog");
    expect(alerts).toContain("judgment_backlog");

    // The backlog drains (rows leave the queue states): the next reconcile clears both alerts.
    await env.DB.prepare(
      `UPDATE offerings SET status = 'kept' WHERE id IN ('backlog-perceivable', 'backlog-perceived')`
    ).run();
    await reconcileBacklogAlerts(env, now);
    const cleared = await activeAlerts(env.DB);
    expect(cleared).not.toContain("perception_backlog");
    expect(cleared).not.toContain("judgment_backlog");
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

  it("gates the terminal 'set aside' note on winning the failed-CAS — both the moderation and perception branches", async () => {
    // eye.ts writes the terminal 'set aside' PRIEST note ONLY when its failed-CAS won. If a concurrent tick
    // already moved the row on, the CAS loses and NO false 'set aside' may reach the public codex (which
    // serves PRIEST/system lines). BOTH dead-letter branches share this gate — moderation
    // (expectedStatus:'moderating') and perception (expectedStatus:'perceiving'). Driven directly, as the
    // losing branch cannot be reached single-threaded once a tick has claimed the row.
    const cases = [
      { from: "moderating", won: "cas-win-mod", lost: "cas-lost-mod", movedTo: "perceivable" },
      { from: "perceiving", won: "cas-win-perc", lost: "cas-lost-perc", movedTo: "perceived" },
    ] as const;
    for (const c of cases) {
      await insertOffering(env.DB, { id: c.won, wallet: null, sig: null, image_key: `quarantine/${c.won}`,
        sha256: c.won, status: c.from, attempts: 0, created_at: Date.now(), perceived_at: null });
      await insertOffering(env.DB, { id: c.lost, wallet: null, sig: null, image_key: `quarantine/${c.lost}`,
        sha256: c.lost, status: c.movedTo, attempts: 0, created_at: Date.now(), perceived_at: null }); // already moved on
      for (const id of [c.won, c.lost]) {
        if (await setOfferingStatus(env.DB, id, "failed", { expectedStatus: c.from })) {
          await env.DB.prepare(`INSERT INTO transcripts (id, organ, register, text, offering_id, rite_id, created_at)
            VALUES (?1, 'PRIEST', 'system', ?2, ?3, NULL, ?4)`).bind(ulid(), `offering ${id} set aside`, id, Date.now()).run();
        }
      }
    }
    const noteFor = async (id: string) => (await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM transcripts WHERE organ='PRIEST' AND register='system' AND offering_id=?1`
    ).bind(id).first<{ n: number }>())?.n;
    expect(await noteFor("cas-win-mod")).toBe(1);   // won moderating->failed: note written
    expect(await noteFor("cas-lost-mod")).toBe(0);  // lost (row already perceivable): NO false note
    expect(await noteFor("cas-win-perc")).toBe(1);  // won perceiving->failed: note written
    expect(await noteFor("cas-lost-perc")).toBe(0); // lost (row already perceived): NO false note
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

  it("moderation unavailable (no live key): a pending offering with a real quarantine object is left exactly as-is — never destroyed", async () => {
    const id = "moderation-unavailable-me";
    await env.RELICS.put(`quarantine/${id}`, PNG);
    await insertOffering(env.DB, { id, wallet: null, sig: null,
      image_key: `quarantine/${id}`, sha256: id, status: "pending",
      attempts: 0, created_at: Date.now(), perceived_at: null });

    // No valid ANTHROPIC_API_KEY in this suite, so moderate() throws ModerationUnavailableError —
    // this is the core regression guard for Commit A: an infra failure (bad key, timeout, outage)
    // must never be fabricated into a content rejection that destroys the offering.
    const n = await runEyeBatch(env);
    expect(n).toBe(0);

    const row = await env.DB.prepare(`SELECT status, attempts, image_key FROM offerings WHERE id = ?1`)
      .bind(id).first<{ status: string; attempts: number; image_key: string }>();
    expect(row?.status).toBe("pending"); // not rejected, not failed
    expect(row?.attempts).toBe(0); // unchanged — this is not a "failed attempt", it's an outage
    expect(row?.image_key).toBe(`quarantine/${id}`);
    const stillThere = await env.RELICS.get(`quarantine/${id}`);
    expect(stillThere).not.toBeNull(); // the R2 object was never deleted
    await stillThere?.arrayBuffer();
  });

  it("raises a non-public 'moderation_stuck' alert once the oldest pending offering has waited well past a normal tick delay, and clears it once nothing is stuck", async () => {
    const staleId = "stuck-moderation-alert";
    await env.RELICS.put(`quarantine/${staleId}`, PNG);
    // Old enough to clear MODERATION_STUCK_THRESHOLD_MS (2h) regardless of ModerationUnavailableError's
    // own no-bump reset — this offering has genuinely been sitting unmoderated far too long.
    await insertOffering(env.DB, { id: staleId, wallet: null, sig: null,
      image_key: `quarantine/${staleId}`, sha256: staleId, status: "pending",
      attempts: 0, created_at: Date.now() - 3 * 60 * 60_000, perceived_at: null });

    await runEyeBatch(env); // no live ANTHROPIC_API_KEY -> ModerationUnavailableError -> resets to pending
    expect(await activeAlerts(env.DB)).toContain("moderation_stuck");
    // The offering itself is untouched by this alert — still exactly the "never destroy on outage"
    // behavior the companion test above already guards.
    expect(await offeringStatusById(env.DB, staleId)).toBe("pending");

    // Once the stale offering is no longer pending (e.g. an operator manually resolved it), and no
    // other pending row is old enough, the alert clears on the next tick.
    await setOfferingStatus(env.DB, staleId, "failed", { expectedStatus: "pending" });
    await runEyeBatch(env);
    expect(await activeAlerts(env.DB)).not.toContain("moderation_stuck");
  });

  it("does not raise 'moderation_stuck' for an ordinary, recently-submitted pending backlog", async () => {
    const freshId = "fresh-pending-no-alert";
    await env.RELICS.put(`quarantine/${freshId}`, PNG);
    await insertOffering(env.DB, { id: freshId, wallet: null, sig: null,
      image_key: `quarantine/${freshId}`, sha256: freshId, status: "pending",
      attempts: 0, created_at: Date.now(), perceived_at: null });

    await runEyeBatch(env);
    expect(await activeAlerts(env.DB)).not.toContain("moderation_stuck");
  });

  it("moderation status transitions are CAS-guarded: once a rejected offering lands, a stale overlapping tick's pending->perceivable attempt does not resurrect it", async () => {
    const id = "reject-then-stale-allow";
    await env.RELICS.put(`quarantine/${id}`, PNG);
    await insertOffering(env.DB, { id, wallet: null, sig: null,
      image_key: `quarantine/${id}`, sha256: id, status: "pending",
      attempts: 0, created_at: Date.now(), perceived_at: null });

    // Simulates a real tick that moderated and won the pending->rejected CAS (the genuine
    // reject verdict path requires a live ANTHROPIC_API_KEY — see Commit A's report note — so
    // this test drives the CAS transition directly rather than through moderate()/runEyeBatch;
    // the guarantee under test is setOfferingStatus's CAS guard, not moderation itself).
    const rejectWon = await setOfferingStatus(env.DB, id, "rejected", { expectedStatus: "pending" });
    expect(rejectWon).toBe(true);
    const afterReject = await env.DB.prepare(`SELECT status FROM offerings WHERE id = ?1`)
      .bind(id).first<{ status: string }>();
    expect(afterReject?.status).toBe("rejected");

    // Simulates a second, stale tick that started before the reject landed (a lock-lease
    // overrun) and is only now attempting to apply an "allow" verdict it computed against the
    // pending row it originally read. The CAS's expectedStatus no longer matches, so the
    // transition is refused — the exact resurrection this guard exists to prevent.
    const staleWon = await setOfferingStatus(env.DB, id, "perceivable", { expectedStatus: "pending" });
    expect(staleWon).toBe(false);

    const finalRow = await env.DB.prepare(`SELECT status FROM offerings WHERE id = ?1`)
      .bind(id).first<{ status: string }>();
    expect(finalRow?.status).toBe("rejected"); // never resurrected
  });
});

describe("EYE publish idempotency", () => {
  it("publishPerception flips perceiving->perceived and publishes the transcript exactly once in one atomic batch; a re-run is a clean no-op", async () => {
    const id = "idempotent-perceive-me";
    await insertOffering(env.DB, { id, wallet: null, sig: null,
      image_key: `offerings/${id}`, sha256: id, status: "perceiving",
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

// Fix Wave 6: the allow branch now promotes BEFORE the pending->perceivable CAS (instead of
// CAS-then-promote), so a perceivable row's image is always durably at offerings/<id> and can
// never be left pointing at a quarantine/ key the 24h sweep could delete. moderate() can't be
// driven to an "allow" verdict in this suite (no live ANTHROPIC_API_KEY), so these tests exercise
// the R2/D1 pieces the allow branch composes directly, matching the pattern the existing
// promoteFromQuarantine tests above already use. The true end-to-end happy path is covered by the
// live suite.
describe("allow-path promote-before-perceivable ordering (Fix Wave 6)", () => {
  it("promotes to offerings/<id> before the pending->perceivable transition runs, so the image is never left pointing at quarantine/", async () => {
    const id = "promote-before-perceivable";
    await env.RELICS.put(`quarantine/${id}`, PNG);
    await insertOffering(env.DB, { id, wallet: null, sig: null,
      image_key: `quarantine/${id}`, sha256: id, status: "moderating",
      attempts: 0, created_at: Date.now(), perceived_at: null });
    const row = (await env.DB.prepare(`SELECT * FROM offerings WHERE id = ?1`)
      .bind(id).first<OfferingRow>())!;

    // Simulate the allow branch's new order: promote first, then attempt the CAS.
    await promoteFromQuarantine(env, row);

    // Even before the status transition runs, the image is already durably at offerings/<id> —
    // a perceivable row's image_key can never point at a quarantine/ key the sweep could delete.
    const midway = await env.DB.prepare(`SELECT image_key FROM offerings WHERE id = ?1`)
      .bind(id).first<{ image_key: string }>();
    expect(midway?.image_key).toBe(`offerings/${id}`);
    const promoted = await env.RELICS.get(`offerings/${id}`);
    expect(promoted).not.toBeNull();
    await promoted?.arrayBuffer();

    const won = await setOfferingStatus(env.DB, id, "perceivable", { expectedStatus: "moderating" });
    expect(won).toBe(true);
    const final = await env.DB.prepare(`SELECT status, image_key FROM offerings WHERE id = ?1`)
      .bind(id).first<{ status: string; image_key: string }>();
    expect(final?.status).toBe("perceivable");
    expect(final?.image_key).toBe(`offerings/${id}`);
  });

  it("reclaims the promoted object when the pending->perceivable CAS is lost to a concurrent reject", async () => {
    const id = "lost-cas-reclaim";
    await env.RELICS.put(`quarantine/${id}`, PNG);
    await insertOffering(env.DB, { id, wallet: null, sig: null,
      image_key: `quarantine/${id}`, sha256: id, status: "moderating",
      attempts: 0, created_at: Date.now(), perceived_at: null });
    const row = (await env.DB.prepare(`SELECT * FROM offerings WHERE id = ?1`)
      .bind(id).first<OfferingRow>())!;

    // This tick promotes the object — the winning tick's first step in the new order.
    await promoteFromQuarantine(env, row);
    const promoted = await env.RELICS.get(`offerings/${id}`);
    expect(promoted).not.toBeNull();
    await promoted?.arrayBuffer();

    // ...but loses the race: a concurrent tick reaches a "reject" verdict on the same row first.
    const rejectWon = await setOfferingStatus(env.DB, id, "rejected", { expectedStatus: "moderating" });
    expect(rejectWon).toBe(true);

    // This tick's own CAS to perceivable now fails (status is no longer 'moderating').
    const allowWon = await setOfferingStatus(env.DB, id, "perceivable", { expectedStatus: "moderating" });
    expect(allowWon).toBe(false);

    // Per the eye.ts allow-branch reclaim logic: the row is now 'rejected', so the object this
    // tick promoted is an orphan the reject path could not see (it only deletes the quarantine
    // key) — reclaim it.
    expect(await offeringStatusById(env.DB, id)).toBe("rejected");
    await env.RELICS.delete(`offerings/${id}`);
    expect(await env.RELICS.get(`offerings/${id}`)).toBeNull();
  });

  it("does NOT reclaim the promoted object when the pending->perceivable CAS is lost to a concurrent allow — the winner needs that key", async () => {
    const id = "lost-cas-no-reclaim";
    await env.RELICS.put(`quarantine/${id}`, PNG);
    await insertOffering(env.DB, { id, wallet: null, sig: null,
      image_key: `quarantine/${id}`, sha256: id, status: "moderating",
      attempts: 0, created_at: Date.now(), perceived_at: null });
    const row = (await env.DB.prepare(`SELECT * FROM offerings WHERE id = ?1`)
      .bind(id).first<OfferingRow>())!;

    // This tick promotes...
    await promoteFromQuarantine(env, row);

    // ...but another overlapping tick, also with an "allow" verdict for the same row, wins the
    // transition to perceivable first.
    const winnerWon = await setOfferingStatus(env.DB, id, "perceivable", { expectedStatus: "moderating" });
    expect(winnerWon).toBe(true);

    // This tick's own CAS now fails, but the row is 'perceivable', not 'rejected' — the reclaim
    // guard must NOT fire, because the winning tick's row still points at this exact key.
    const allowWon = await setOfferingStatus(env.DB, id, "perceivable", { expectedStatus: "moderating" });
    expect(allowWon).toBe(false);
    expect(await offeringStatusById(env.DB, id)).toBe("perceivable");

    // The object must survive: it is not deleted.
    const obj = await env.RELICS.get(`offerings/${id}`);
    expect(obj).not.toBeNull();
    await obj?.arrayBuffer();
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

  it("does not delete an aged quarantine/ object still referenced by a pending offering, but does delete an aged orphan with no matching row — an offering paused by a moderator outage must never have its image destroyed", async () => {
    const pendingId = "sweep-pending-keep";
    const orphanId = "sweep-orphan-gone";
    await env.RELICS.put(`quarantine/${pendingId}`, PNG);
    await env.RELICS.put(`quarantine/${orphanId}`, PNG);
    await insertOffering(env.DB, { id: pendingId, wallet: null, sig: null,
      image_key: `quarantine/${pendingId}`, sha256: pendingId, status: "pending",
      attempts: 0, created_at: Date.now(), perceived_at: null });

    const future = Date.now() + 25 * 60 * 60_000; // both objects read as aged
    const deleted = await sweepQuarantine(env, future);
    expect(deleted).toBe(1); // only the orphan

    const stillPending = await env.RELICS.get(`quarantine/${pendingId}`);
    expect(stillPending).not.toBeNull(); // preserved — a future moderation attempt still needs it
    await stillPending?.arrayBuffer();
    expect(await env.RELICS.get(`quarantine/${orphanId}`)).toBeNull();
  });

  it("does not delete an aged quarantine/ object referenced by a mid-lifecycle offering (moderating/perceiving) — a >24h processing backlog must not destroy an in-flight image before it is perceived", async () => {
    const moderatingId = "sweep-moderating-keep";
    const perceivingId = "sweep-perceiving-keep";
    await env.RELICS.put(`quarantine/${moderatingId}`, PNG);
    await env.RELICS.put(`quarantine/${perceivingId}`, PNG);
    // Both rows are claimed and in flight but still point at their quarantine object (promotion to
    // offerings/<id> has not landed yet). Under the old 'pending'-only guard the sweep would delete
    // these live images out from under an allowed offering that has simply not been perceived yet.
    await insertOffering(env.DB, { id: moderatingId, wallet: null, sig: null,
      image_key: `quarantine/${moderatingId}`, sha256: moderatingId, status: "moderating",
      attempts: 0, created_at: Date.now(), perceived_at: null });
    await insertOffering(env.DB, { id: perceivingId, wallet: null, sig: null,
      image_key: `quarantine/${perceivingId}`, sha256: perceivingId, status: "perceiving",
      attempts: 0, created_at: Date.now(), perceived_at: null });

    const future = Date.now() + 25 * 60 * 60_000; // both objects read as aged
    const deleted = await sweepQuarantine(env, future);
    expect(deleted).toBe(0); // neither is terminal, so neither image may be reclaimed

    const keptModerating = await env.RELICS.get(`quarantine/${moderatingId}`);
    expect(keptModerating).not.toBeNull();
    await keptModerating?.arrayBuffer(); // consume the body so isolated storage can pop
    const keptPerceiving = await env.RELICS.get(`quarantine/${perceivingId}`);
    expect(keptPerceiving).not.toBeNull();
    await keptPerceiving?.arrayBuffer();
  });

  it("deletes an aged quarantine/ object whose offering row is terminal (rejected/failed) — those images are never reclaimable", async () => {
    const rejectedId = "sweep-rejected-reclaim";
    const failedId = "sweep-failed-reclaim";
    await env.RELICS.put(`quarantine/${rejectedId}`, PNG);
    await env.RELICS.put(`quarantine/${failedId}`, PNG);
    await insertOffering(env.DB, { id: rejectedId, wallet: null, sig: null,
      image_key: `quarantine/${rejectedId}`, sha256: rejectedId, status: "rejected",
      attempts: 0, created_at: Date.now(), perceived_at: null });
    await insertOffering(env.DB, { id: failedId, wallet: null, sig: null,
      image_key: `quarantine/${failedId}`, sha256: failedId, status: "failed",
      attempts: 2, created_at: Date.now(), perceived_at: null });

    const future = Date.now() + 25 * 60 * 60_000;
    const deleted = await sweepQuarantine(env, future);
    expect(deleted).toBe(2);
    expect(await env.RELICS.get(`quarantine/${rejectedId}`)).toBeNull();
    expect(await env.RELICS.get(`quarantine/${failedId}`)).toBeNull();
  });
});
