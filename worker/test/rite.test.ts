import { env } from "cloudflare:test";
import { ulid } from "ulid";
import { beforeAll, describe, expect, it } from "vitest";
import { openRite, getRite, advanceRite, nonTerminalRites, PHASE_ORDER, PHASE_DEADLINE_MS } from "../src/rite";
import { insertOffering, insertRelic, addTranscript, publishSermon } from "../src/db";
import { activeAlerts } from "../src/alert";
import { applyMigrations } from "./helpers";

beforeAll(() => applyMigrations(env.DB));

describe("rite state machine", () => {
  it("opens idempotently and walks the phases one step per advance", async () => {
    const date = "2026-07-12";
    const t = Date.parse(date + "T00:50:00Z");
    await openRite(env.DB, date, t);
    await openRite(env.DB, date, t); // second open is a no-op
    expect((await getRite(env.DB, date))?.phase).toBe("scheduled");

    // seed one perceived offering with a verse so deliberation (KEEP) has work
    await insertOffering(env.DB, { id: "rite-o1", wallet: null, sig: null, image_key: "offerings/rite-o1",
      sha256: "rite-o1", status: "perceived", attempts: 0, created_at: t, perceived_at: t });
    await env.DB.prepare(`INSERT INTO transcripts (id, organ, register, text, offering_id, rite_id, created_at)
      VALUES ('rv1','EYE','verse','a mark', 'rite-o1', NULL, ?1)`).bind(t).run();

    let phase = (await getRite(env.DB, date))!.phase;
    const seen: string[] = [phase];
    for (let i = 0; i < 8 && phase !== "complete" && phase !== "failed"; i++) {
      phase = await advanceRite(env, date, t + i * 60_000);
      seen.push(phase);
    }
    // offertory_close snapshots, deliberation runs KEEP (no key -> keeps 0 but still advances),
    // accretion marks relics accreted, and the sermon closes: with nothing kept the rite closes in
    // silence (no live voice needed) and reaches complete in the keyless suite.
    expect(seen).toEqual([
      "scheduled", "offertory_close", "deliberation", "accretion", "sermon", "complete",
    ]);
    expect(PHASE_ORDER).toContain("accretion");
  });

  it("records the offering snapshot as the offertory closes and is idempotent if re-run in that phase", async () => {
    const date = "2026-07-13";
    const t = Date.parse(date + "T00:50:00Z");
    await insertOffering(env.DB, { id: "snap-1", wallet: null, sig: null, image_key: "offerings/snap-1",
      sha256: "snap-1", status: "perceived", attempts: 0, created_at: t, perceived_at: t });
    await openRite(env.DB, date, t);
    await advanceRite(env, date, t);          // scheduled -> offertory_close (snapshot taken as offertory closes)
    const r1 = await getRite(env.DB, date);
    expect(r1?.phase).toBe("offertory_close");
    expect(r1?.offering_snapshot).toBeGreaterThanOrEqual(1);
  });

  it("resumes from the stored phase after a simulated missed cron", async () => {
    const date = "2026-07-14";
    const t = Date.parse(date + "T00:50:00Z");
    await openRite(env.DB, date, t);
    await advanceRite(env, date, t); // -> offertory_close
    // Simulate a long gap (missed crons): a later advance simply continues from offertory_close.
    const next = await advanceRite(env, date, t + 6 * 3600_000);
    expect(next).toBe("deliberation");
  });

  it("moves a phase to failed after MAX_PHASE_RETRIES transient failures", async () => {
    const date = "2026-07-15";
    const t = Date.parse(date + "T00:50:00Z");
    await openRite(env.DB, date, t);
    // The sermon speaks only when the rite kept something; seed one kept relic so the sermon actually
    // reaches for the live voice (TONGUE) and, with no key, fails -> retries -> lands failed.
    await insertRelic(env.DB, { id: "sermon-relic-1", offering_id: "sermon-o1", wallet: null,
      summary: "a kept mark", rite_id: date, kept_at: t, genesis: 0, accreted_at: null });
    // fast-forward to the sermon phase by driving the no-LLM phases, then force retries on sermon.
    await advanceRite(env, date, t); // -> offertory_close
    await advanceRite(env, date, t); // -> deliberation
    await advanceRite(env, date, t); // -> accretion
    await advanceRite(env, date, t); // -> sermon
    expect((await getRite(env.DB, date))?.phase).toBe("sermon");
    for (let i = 0; i < 3; i++) await advanceRite(env, date, t); // sermon askMind fails w/o key
    expect((await getRite(env.DB, date))?.phase).toBe("failed");
  });

  it("fails a phase that has been ERRORING past its wall-clock budget before MAX retries (deadline, not retry count), and raises an alert", async () => {
    const date = "2026-07-19";
    const t = Date.parse(date + "T00:50:00Z");
    await openRite(env.DB, date, t);
    // A kept relic so the sermon phase reaches for the (keyless-unavailable) live voice and throws.
    await insertRelic(env.DB, { id: "deadline-relic-1", offering_id: "deadline-o1", wallet: null,
      summary: "a kept mark", rite_id: date, kept_at: t, genesis: 0, accreted_at: null });
    await advanceRite(env, date, t); // -> offertory_close
    await advanceRite(env, date, t); // -> deliberation
    await advanceRite(env, date, t); // -> accretion
    await advanceRite(env, date, t); // -> sermon
    expect((await getRite(env.DB, date))?.phase).toBe("sermon");
    // Simulate a phase stuck erroring: its first strike landed well past the budget ago (the 0 -> 1
    // strike is what anchors the deadline clock; attempts = 1 makes this next error strike #2), so
    // the deadline fails it now without waiting out the full retry ladder.
    await env.DB.prepare(`UPDATE rites SET phase_started_at = ?2, phase_attempts = 1 WHERE date = ?1`)
      .bind(date, t - (PHASE_DEADLINE_MS.sermon + 60_000)).run();
    const next = await advanceRite(env, date, t); // erroring past budget -> fails before MAX retries
    expect(next).toBe("failed");
    expect(await activeAlerts(env.DB)).toContain("rite_failed");
  });

  it("a transient error one real tick (15 min) after phase entry is NOT terminal — the retry ladder survives cron cadence", async () => {
    const date = "2026-07-27";
    const t = Date.parse(date + "T00:50:00Z");
    const TICK = 15 * 60_000;
    await openRite(env.DB, date, t);
    // A kept relic so the sermon phase reaches for the (keyless-unavailable) live voice and throws.
    await insertRelic(env.DB, { id: "cadence-relic-1", offering_id: "cadence-o1", wallet: null,
      summary: "a kept mark", rite_id: date, kept_at: t, genesis: 0, accreted_at: null });
    // Real cadence: the tick advances one phase per invocation, 15 minutes apart, so a phase's
    // FIRST action attempt always runs ~15 minutes after its phase_started_at was stamped.
    let now = t;
    for (const expected of ["offertory_close", "deliberation", "accretion", "sermon"] as const) {
      now += TICK;
      expect(await advanceRite(env, date, now)).toBe(expected);
    }
    // First keyless sermon error, one tick after phase entry: it must bump the ladder and stay in
    // place — not terminally fail the whole public day on a single blip.
    now += TICK;
    expect(await advanceRite(env, date, now)).toBe("sermon");
    expect((await getRite(env.DB, date))?.phase).toBe("sermon");
    // The ladder then completes across later ticks: strikes two and three land it failed.
    now += TICK;
    expect(await advanceRite(env, date, now)).toBe("sermon");
    now += TICK;
    expect(await advanceRite(env, date, now)).toBe("failed");
  });

  it("does not re-publish the sermon on resume after a partial prior run (idempotent per rite date)", async () => {
    const date = "2026-07-18";
    const t = Date.parse(date + "T00:50:00Z");
    await openRite(env.DB, date, t);
    // A kept relic so the sermon phase would normally reach for the live voice.
    await insertRelic(env.DB, { id: "resume-relic-1", offering_id: "resume-o1", wallet: null,
      summary: "a kept mark", rite_id: date, kept_at: t, genesis: 0, accreted_at: null });
    await advanceRite(env, date, t); // -> offertory_close
    await advanceRite(env, date, t); // -> deliberation
    await advanceRite(env, date, t); // -> accretion
    await advanceRite(env, date, t); // -> sermon
    expect((await getRite(env.DB, date))?.phase).toBe("sermon");
    // Simulate a partial prior run: the sermon transcript landed but the phase advance did not.
    await addTranscript(env.DB, { id: "resume-sermon-1", organ: "TONGUE", register: "sermon",
      text: "the epoch closes", offering_id: null, rite_id: date, created_at: t });
    // Resume: the sermon must see it already spoke, SKIP the (keyless-unavailable) recompose, and advance
    // straight to complete — no second askMind, no duplicate sermon. Without the guard this would call the
    // mind with no key, throw, and stay in `sermon`.
    const next = await advanceRite(env, date, t);
    expect(next).toBe("complete");
    const n = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM transcripts WHERE organ = 'TONGUE' AND register = 'sermon' AND rite_id = ?1`
    ).bind(date).first<{ n: number }>();
    expect(n?.n).toBe(1); // exactly one sermon transcript: the resume did not double-publish
  });

  it("publishSermon lands at most one sermon per rite — a concurrent lease-overrun actor cannot double-publish", async () => {
    // The rite lock closes the common case; this guards the overrun where two actors both compose. The
    // guarded insert (WHERE NOT EXISTS) + partial UNIQUE backstop mean only the first lands and the second
    // returns false (not throws), so the caller knows not to also speak. Scripture must be genuine + unedited.
    const date = "2026-07-25";
    const first = await publishSermon(env.DB, { transcriptId: ulid(), riteId: date, utterance: "the first epoch closes", at: Date.now() });
    const second = await publishSermon(env.DB, { transcriptId: ulid(), riteId: date, utterance: "a second, forbidden sermon", at: Date.now() });
    expect(first).toBe(true);
    expect(second).toBe(false);
    const rows = (await env.DB.prepare(
      `SELECT text FROM transcripts WHERE organ='TONGUE' AND register='sermon' AND rite_id=?1`
    ).bind(date).all<{ text: string }>()).results;
    expect(rows.length).toBe(1);
    expect(rows[0].text).toBe("the first epoch closes"); // the winner's sermon, not the second
  });

  it("a failed rite's public codex line omits internal diagnostics; the exact cause reaches only the operator alert", async () => {
    const date = "2026-07-26";
    const t = Date.parse(date + "T00:50:00Z");
    await openRite(env.DB, date, t);
    await insertRelic(env.DB, { id: "leak-relic-1", offering_id: "leak-o1", wallet: null,
      summary: "a kept mark", rite_id: date, kept_at: t, genesis: 0, accreted_at: null });
    await advanceRite(env, date, t); // -> offertory_close
    await advanceRite(env, date, t); // -> deliberation
    await advanceRite(env, date, t); // -> accretion
    await advanceRite(env, date, t); // -> sermon
    // Re-age past budget with a prior strike recorded (the first strike anchors the deadline
    // clock), so the next (keyless) sermon error fails via the deadline.
    await env.DB.prepare(`UPDATE rites SET phase_started_at = ?2, phase_attempts = 1 WHERE date = ?1`)
      .bind(date, t - (PHASE_DEADLINE_MS.sermon + 60_000)).run();
    expect(await advanceRite(env, date, t)).toBe("failed");
    // Public PRIEST/system line: states the failure, but carries no ms budget / attempt count / "deadline".
    const pub = await env.DB.prepare(
      `SELECT text FROM transcripts WHERE organ='PRIEST' AND register='system' AND rite_id=?1 ORDER BY created_at DESC LIMIT 1`
    ).bind(date).first<{ text: string }>();
    expect(pub?.text).toContain("did not complete");
    expect(pub?.text).not.toMatch(/ms|attempt|deadline/i);
    // The operator alert (private config) DOES retain the exact diagnostic cause.
    const alert = await env.DB.prepare(`SELECT value FROM config WHERE key='alert:rite_failed'`).first<{ value: string }>();
    expect(alert?.value).toMatch(/ms deadline|attempts/);
  });

  it("drains all non-terminal rites oldest-first so a day-boundary outage never orphans the older rite", async () => {
    // An outage spanned a day boundary: an older rite is stranded mid-phase while a newer rite opens.
    const older = "2026-07-16";
    const newer = "2026-07-17";
    const to = Date.parse(older + "T00:50:00Z");
    const tn = Date.parse(newer + "T00:50:00Z");
    await openRite(env.DB, older, to);
    await advanceRite(env, older, to); // older stranded at offertory_close by the outage
    await openRite(env.DB, newer, tn); // newer day opens while the older rite is unfinished

    const pending = await nonTerminalRites(env.DB);
    const dates = pending.map(r => r.date);
    expect(dates).toContain(older);
    expect(dates).toContain(newer);
    expect(dates.indexOf(older)).toBeLessThan(dates.indexOf(newer)); // oldest-first: older drains first
  });
});

describe("sermon-audio backfill (tick-side heal for a preached-but-silent sermon)", () => {
  const notes = async (riteId: string) => (await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM transcripts WHERE organ = 'PRIEST' AND register = 'system'
     AND rite_id = ?1 AND text LIKE 'sermon audio:%'`
  ).bind(riteId).first<{ n: number }>())!.n;

  it("speaks the latest silent sermon once, posts the receipt note, and is idempotent", async () => {
    const date = "2026-07-17";
    const at = Date.now() + 60_000; // strictly latest among all sermons this file created
    await addTranscript(env.DB, { id: ulid(), organ: "TONGUE", register: "sermon",
      text: "A backfill psalm, preached in silence.", offering_id: null, rite_id: date, created_at: at });
    const { backfillSermonAudio } = await import("../src/rite");
    await backfillSermonAudio(env);
    expect(await notes(date)).toBe(1);
    const note = await env.DB.prepare(
      `SELECT text FROM transcripts WHERE organ = 'PRIEST' AND rite_id = ?1 AND text LIKE 'sermon audio:%'`
    ).bind(date).first<{ text: string }>();
    const key = /sermon audio:\s*(\S+)/.exec(note!.text)![1];
    expect(key).toMatch(/^audio\/[0-9a-f]{64}\.(?:mp3|wav)$/); // the exact shape the web parser accepts
    expect(await env.RELICS.head(key)).not.toBeNull(); // the audio genuinely exists in R2
    await backfillSermonAudio(env); // second tick: the note exists, nothing new happens
    expect(await notes(date)).toBe(1);
  });

  it("leaves a sermon whose rite already carries an audio note untouched", async () => {
    const date = "2026-07-18";
    const at = Date.now() + 120_000; // latest sermon overall, already noted
    await addTranscript(env.DB, { id: ulid(), organ: "TONGUE", register: "sermon",
      text: "An already-voiced psalm.", offering_id: null, rite_id: date, created_at: at });
    await addTranscript(env.DB, { id: ulid(), organ: "PRIEST", register: "system",
      text: "sermon audio: audio/" + "ab".repeat(32) + ".mp3", offering_id: null, rite_id: date, created_at: at + 1 });
    const { backfillSermonAudio } = await import("../src/rite");
    await backfillSermonAudio(env);
    expect(await notes(date)).toBe(1); // still exactly the one pre-existing note
  });
});
