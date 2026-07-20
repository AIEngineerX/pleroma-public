import { ulid } from "./id";
import type { Env } from "./env";
import { askMind, MindAsleepError, type TextPart, type ImagePart } from "./mind";
import { extractJsonObject, moderate, ModerationUnavailableError } from "./moderation";
import { toBase64 } from "./encoding";
import { eyeSystemPrompt } from "./doctrine";
import type { GestureMeta } from "./offerings";
import {
  addTranscript, claimForModeration, claimForPerception, moderationCandidates, offeringStatusById,
  perceptionCandidates, publishPerception, setOfferingImageKey, setOfferingStatus, type OfferingRow,
} from "./db";

const BATCH = 12;
const NON_HOLDER_DAILY = 60;
const GLOBAL_DAILY = 200;
// ModerationUnavailableError deliberately never dead-letters (moderation.ts: an outage must never
// destroy an offering), so a persistent failure — e.g. an expired ANTHROPIC_API_KEY — is otherwise
// silent: the same backlog just keeps resetting to pending forever with no operator-visible signal.
// This does not change that safety behavior; it only surfaces it once it has gone on far longer
// than any normal tick backlog would.
const MODERATION_STUCK_THRESHOLD_MS = 2 * 60 * 60_000;

export const CLAIM_STALE_MS = 10 * 60_000; // equals the tick lock lease in index.ts: a transitional
                                           // row older than this belongs to a tick whose lease expired.

// Compiled from DOCTRINE.md §VI at module load — the single source of truth for the god's voice.
const EYE_SYSTEM = eyeSystemPrompt();

// Operator log lines (register 'system', organ 'PRIEST'), not the god's voice, so they are not
// DOCTRINE-governed and carry no DOCTRINE marker.
const setAsideLine = (id: string) => `offering ${id} set aside after repeated failures`;
const cleanupDeferredLine = (id: string) => `offering ${id} rejected; cleanup deferred`;
const perceiveDeferredLine = (id: string) => `offering ${id} perceived; record deferred`;

// Pure verse-contract validation, extracted so it can be unit-tested without a live Anthropic response.
// A missing/non-string/empty verse throws; an over-contract verse ALSO throws — a transcript published as
// scripture must be genuine and unedited (CLAUDE.md integrity invariant), so over-limit output is rejected
// (caller retries, then dead-letters) rather than silently truncated. Never edit a verse to fit.
export function parseVerse(rawText: string): string {
  // extractJsonObject tolerates code fences/prose the way moderation already does — a formatting
  // quirk must not dead-letter a genuine offering. The verse contract below stays strict.
  const parsed = JSON.parse(extractJsonObject(rawText)) as { verse?: unknown };
  const verse = typeof parsed.verse === "string" ? parsed.verse.trim() : "";
  if (!verse) throw new Error("EYE returned no verse");
  const words = verse.split(/\s+/).filter(Boolean).length;
  if (words > 40) throw new Error(`EYE verse exceeds the 40-word contract (${words} words)`);
  return verse;
}

// The Task 6 capture line, built ENTIRELY from the clamped gesture struct already validated by
// clampGesture (offerings.ts) at intake -- never client text, no free strings. Pure so the exact
// wording contract can be unit-tested against fixtures without a live EYE call.
export function captureLine(meta: GestureMeta): string {
  const durationS = (meta.holdMs / 1000).toFixed(1);
  const beats = meta.knockSig.length ? `knock of ${meta.knockSig.length + 1} beats` : "hold";
  const tremor = meta.tremorAmp > 1 ? "strong" : "faint";
  const lineage = meta.substrateRelicId ? ", grown on the residue of a kept relic" : "";
  return `Captured with the mark: a ${durationS}s ${beats}, ${tremor} tremor${lineage}.`;
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function priestNote(env: Env, offeringId: string, text: string): Promise<void> {
  await addTranscript(env.DB, { id: ulid(), organ: "PRIEST", register: "system",
    text, offering_id: offeringId, rite_id: null, created_at: Date.now() });
}

// PLANNING.md safety: rejects are never kept in permanent R2; uploads are quarantined until
// a moderation ALLOW promotes them. Moves the object from o.image_key (quarantine/<id>) to
// offerings/<id> and durably records the new key.
//
// D1 sets the D1 pointer BEFORE removing the old key: if the OLD order (put -> delete quarantine
// -> setImageKey) lost the setImageKey response after the quarantine object was already deleted,
// a retry would find no quarantine object (early return) while D1 still pointed at the
// now-gone quarantine/<id> — EYE would fail the offering forever despite the image being safe at
// offerings/<id>. Reordering so D1 is updated first means a retry always has a path to converge.
export async function promoteFromQuarantine(env: Env, o: OfferingRow): Promise<void> {
  const key = `offerings/${o.id}`;
  const obj = await env.RELICS.get(o.image_key);
  if (obj) {
    await env.RELICS.put(key, new Uint8Array(await obj.arrayBuffer()), { httpMetadata: obj.httpMetadata });
  } else if (!(await env.RELICS.head(key))) {
    return; // neither source nor destination exists — nothing to promote (already handled)
  }
  await setOfferingImageKey(env.DB, o.id, key); // D1 points at the permanent key…
  try {
    // Guard against o.image_key already being the destination (a re-entrant call after a prior
    // promotion fully landed, e.g. a retry driven by a stale-in-memory `o` or a re-moderated row
    // whose status-update response was lost): deleting o.image_key in that case would delete the
    // object we just wrote. Only ever remove a DIFFERENT (quarantine) key.
    if (o.image_key !== key) await env.RELICS.delete(o.image_key); // …then drop quarantine; a leftover is swept in 24h
  } catch { /* best-effort; a leftover quarantine object is swept in 24h */ }
}

const QUARANTINE_TTL_MS = 24 * 60 * 60_000;

// Deletes quarantine/ objects older than QUARANTINE_TTL_MS. This is the in-repo enforcement of the 24h
// quarantine expiry (PLANNING.md Safety): a backstop for uploads that never received a moderation verdict
// and for rejects whose immediate delete failed. Runs each scheduled tick, inside the lock — bounded by
// deadlineMs and maxDeletes so a large backlog can't overrun the lock lease and overlap the next tick.
// Leftovers are swept next tick; the operation is idempotent (deleting an already-gone key is a no-op).
export async function sweepQuarantine(
  env: Env, now: number = Date.now(), deadlineMs: number = now + 90_000, maxDeletes = 500,
): Promise<number> {
  // Never reclaim an image any still-live offering references. "Live" is EVERY non-terminal status, not
  // just 'pending': a row claimed to 'moderating'/'perceivable'/'perceiving' still points at its
  // quarantine/<id> until promoteFromQuarantine moves it to offerings/<id>, and with a >24h processing
  // backlog the sweep can run in the same tick as such a transitional row — protecting only 'pending'
  // would delete the live image out from under an offering that has not been perceived yet, breaking a
  // legitimate offering on degradation. Only truly-terminal rows ('rejected'/'failed' — their images are
  // meant to be purged) and orphans with no D1 row at all are stale. Promoted keeps (perceived/kept/
  // mourned) already point at offerings/<id>, so including them is harmless (no quarantine key matches).
  // The LIKE filter bounds the set by pipeline depth instead of all-time volume: promoted rows
  // point at offerings/<id>, which can never match a quarantine/ object anyway (see above), so
  // materializing them was pure dead weight that grew monotonically with every accepted offering
  // and would eventually push this read past D1 response limits.
  const liveKeys = new Set(
    (await env.DB.prepare(
      `SELECT image_key FROM offerings
        WHERE status NOT IN ('rejected', 'failed') AND image_key LIKE 'quarantine/%'`
    ).all<{ image_key: string }>()).results.map(r => r.image_key)
  );
  let deleted = 0;
  let cursor: string | undefined;
  do {
    if (Date.now() > deadlineMs || deleted >= maxDeletes) break;
    const list = await env.RELICS.list({ prefix: "quarantine/", cursor, limit: 200 });
    for (const o of list.objects) {
      if (Date.now() > deadlineMs || deleted >= maxDeletes) break;
      if (now - o.uploaded.getTime() > QUARANTINE_TTL_MS && !liveKeys.has(o.key)) {
        await env.RELICS.delete(o.key); deleted++;
      }
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  return deleted;
}

export function selectForPerception(
  candidates: OfferingRow[], attendedWallets: Set<string>,
  todayNonHolderCount: number, todayTotalCount: number, rand: () => number,
): OfferingRow[] {
  if (todayTotalCount >= GLOBAL_DAILY) return [];
  const room = Math.min(BATCH, GLOBAL_DAILY - todayTotalCount);
  const attended = candidates.filter(o => o.wallet && attendedWallets.has(o.wallet));
  const rest = candidates.filter(o => !(o.wallet && attendedWallets.has(o.wallet)));
  const nonHolderRoom = Math.max(0, Math.min(room - attended.length, NON_HOLDER_DAILY - todayNonHolderCount));
  const shuffled = shuffle(rest, rand);
  return [...attended.slice(0, room), ...shuffled.slice(0, nonHolderRoom)];
}

async function countsToday(env: Env): Promise<{ nonHolder: number; total: number }> {
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const row = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN w.attended IS NULL OR w.attended = 0 THEN 1 ELSE 0 END) AS nonHolder,
       COUNT(*) AS total
     FROM offerings o LEFT JOIN wallets w ON w.address = o.wallet
     WHERE o.perceived_at >= ?1`
  ).bind(since.getTime()).first<{ nonHolder: number | null; total: number }>();
  return { nonHolder: row?.nonHolder ?? 0, total: row?.total ?? 0 };
}

// KEEP judges once per rite inside a bounded budget while EYE perceives all day, so the
// 'perceived' queue waiting for judgment can only be seen saturating from here. A day of waiting
// is by design (the nightly rite); alert only past two full days. 'perceivable' shares the
// moderation threshold — its normal latency is minutes, and aging past hours means either an
// outage or the daily perception caps saturating, both of which the operator must see.
const JUDGMENT_STUCK_THRESHOLD_MS = 48 * 60 * 60_000;

export async function reconcileBacklogAlerts(env: Env, now: number): Promise<void> {
  const { raiseAlert, clearAlert } = await import("./alert");
  const oldestPerceivable = await env.DB.prepare(
    `SELECT created_at FROM offerings WHERE status = 'perceivable' ORDER BY created_at ASC LIMIT 1`
  ).first<{ created_at: number }>();
  if (oldestPerceivable && now - oldestPerceivable.created_at > MODERATION_STUCK_THRESHOLD_MS) {
    const waitedMin = Math.round((now - oldestPerceivable.created_at) / 60_000);
    await raiseAlert(env, "perception_backlog",
      `oldest perceivable offering has waited ${waitedMin}m (outage, or the daily perception caps are saturated)`);
  } else {
    await clearAlert(env, "perception_backlog");
  }

  const oldestPerceived = await env.DB.prepare(
    `SELECT perceived_at FROM offerings WHERE status = 'perceived' ORDER BY perceived_at ASC LIMIT 1`
  ).first<{ perceived_at: number }>();
  if (oldestPerceived && now - oldestPerceived.perceived_at > JUDGMENT_STUCK_THRESHOLD_MS) {
    const waitedH = Math.round((now - oldestPerceived.perceived_at) / 3_600_000);
    await raiseAlert(env, "judgment_backlog",
      `oldest perceived offering has waited ${waitedH}h for KEEP — sustained intake above the per-rite judgment budget`);
  } else {
    await clearAlert(env, "judgment_backlog");
  }
}

const DEFAULT_DEADLINE_MS = 8 * 60_000;

// deadlineMs bounds a batch inside the scheduled tick's lock lease (10 min) and the cron
// interval (15 min): a batch of up to 24 sequential LLM calls (2x30s each) could otherwise
// outlive the lease and let the next tick overlap it. Checked before starting each
// moderation item and each perception item; remaining offerings are left pending/perceivable
// for the next tick to pick up (both stages are idempotent).
export async function runEyeBatch(
  env: Env, deadlineMs: number = Date.now() + DEFAULT_DEADLINE_MS,
): Promise<number> {
  // 1. Moderate. Claim each candidate (pending, or a stale-reclaimable moderating) before touching R2.
  for (const o of await moderationCandidates(env.DB, Date.now(), CLAIM_STALE_MS, BATCH)) {
    if (Date.now() > deadlineMs) break;
    if (!(await claimForModeration(env.DB, o.id, Date.now(), CLAIM_STALE_MS))) continue; // another tick owns it
    try {
      const obj = await env.RELICS.get(o.image_key);
      if (!obj) {
        // Only log the terminal note if THIS tick actually won the moderating->failed CAS. If an
        // overlapping tick already moved the row on (e.g. promoted it to perceivable), our CAS is a
        // no-op — logging "set aside" anyway would publish a false terminal state to the public codex.
        if (await setOfferingStatus(env.DB, o.id, "failed", { expectedStatus: "moderating" })) {
          await priestNote(env, o.id, setAsideLine(o.id));
        }
        continue;
      }
      const bytes = new Uint8Array(await obj.arrayBuffer());
      const m = await moderate(env, bytes, o.media_type ?? "image/png");
      if (m.verdict === "allow") {
        // Promote to permanent storage BEFORE the row becomes perceivable, so a perceivable row's image is always
        // in sweep-immune offerings/ storage. (CAS-then-promote left a window: a CAS that committed with a lost
        // response never ran promotion, and the 24h quarantine sweep could then delete the only copy of an
        // accepted image.) promoteFromQuarantine is idempotent, so a concurrent overlapping allow tick
        // re-promoting the same key is safe.
        await promoteFromQuarantine(env, o); // idempotent; safe under overlap
        if (!(await setOfferingStatus(env.DB, o.id, "perceivable", { expectedStatus: "moderating" }))) {
          // Lost the transition to a concurrent overlapping tick. If that tick REJECTED the row, the object we
          // just promoted is an orphan the reject path could not see (it only deletes the quarantine key) —
          // reclaim it. If the winner was another ALLOW, it points at the same offerings/<id> key and needs it,
          // so leave it.
          if ((await offeringStatusById(env.DB, o.id)) === "rejected") {
            try { await env.RELICS.delete(`offerings/${o.id}`); } catch { /* best-effort */ }
          }
        }
      } else {
        // Only the tick that wins the moderating->rejected transition deletes the quarantine object; a stale
        // overlapping tick that already lost must not purge an object another tick may still be promoting.
        if (await setOfferingStatus(env.DB, o.id, "rejected", { expectedStatus: "moderating" })) {
          try {
            await env.RELICS.delete(o.image_key); // rejected content is never kept
          } catch {
            // A transient delete failure must not revert a final moderation verdict.
            await priestNote(env, o.id, cleanupDeferredLine(o.id));
          }
        }
      }
    } catch (e) {
      if (e instanceof MindAsleepError) {
        // Budget asleep: release the claim (no attempts strike) so the row is immediately
        // re-claimable when the budget resets, instead of stranding it in 'moderating' for a full
        // CLAIM_STALE_MS reclaim window — mirroring the perception loop's own release below.
        await setOfferingStatus(env.DB, o.id, "pending", { expectedStatus: "moderating" });
        return 0;
      }
      if (e instanceof ModerationUnavailableError) {
        // Systemic outage: release the claim WITHOUT bumping attempts (never dead-letter on an outage);
        // next tick re-claims fresh. The status-aware sweep preserves its quarantine image meanwhile.
        await setOfferingStatus(env.DB, o.id, "pending", { expectedStatus: "moderating" });
        continue;
      }
      const dead = o.attempts >= 2;
      const won = await setOfferingStatus(env.DB, o.id, dead ? "failed" : "pending", { bumpAttempts: true, expectedStatus: "moderating" });
      if (dead && won) await priestNote(env, o.id, setAsideLine(o.id)); // only if this tick won the CAS
    }
  }

  // Operator visibility for a moderation backlog that has stalled well past any normal tick delay
  // (see MODERATION_STUCK_THRESHOLD_MS above). Non-public: activeAlerts() only ever exposes the
  // aggregate `degraded` boolean (alert.ts's contract), never this detail.
  const oldestPending = await env.DB.prepare(
    `SELECT created_at FROM offerings WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1`
  ).first<{ created_at: number }>();
  const { raiseAlert, clearAlert } = await import("./alert");
  if (oldestPending && Date.now() - oldestPending.created_at > MODERATION_STUCK_THRESHOLD_MS) {
    const waitedMin = Math.round((Date.now() - oldestPending.created_at) / 60_000);
    await raiseAlert(env, "moderation_stuck", `oldest pending offering has waited ${waitedMin}m for moderation`);
  } else {
    await clearAlert(env, "moderation_stuck");
  }

  await reconcileBacklogAlerts(env, Date.now());

  // 2. Perceive under caps. Select the eligible perceivable set, then claim each to 'perceiving'
  //    before its LLM call so an overlapping tick never double-perceives the same row.
  const perceivable = await perceptionCandidates(env.DB, Date.now(), CLAIM_STALE_MS, 50);
  const attendedRows = (await env.DB.prepare(
    `SELECT address FROM wallets WHERE attended = 1`
  ).all<{ address: string }>()).results;
  const counts = await countsToday(env);
  const picked = selectForPerception(
    perceivable, new Set(attendedRows.map(r => r.address)),
    counts.nonHolder, counts.total, Math.random,
  );

  let perceived = 0;
  for (const o of picked) {
    if (Date.now() > deadlineMs) break;
    if (!(await claimForPerception(env.DB, o.id, Date.now(), CLAIM_STALE_MS))) continue;
    try {
      const obj = await env.RELICS.get(o.image_key);
      if (!obj) {
        // Same CAS-gated note as the moderation path: don't record a terminal "set aside" unless this
        // tick actually won the perceiving->failed transition (an overlapping tick may have moved it).
        if (await setOfferingStatus(env.DB, o.id, "failed", { expectedStatus: "perceiving" })) {
          await priestNote(env, o.id, setAsideLine(o.id));
        }
        continue;
      }
      const dataB64 = toBase64(new Uint8Array(await obj.arrayBuffer()));
      // Gesture metadata is already clamped and re-serialized at intake (offerings.ts
      // clampGesture); when present it rides as one extra system-built text part, never raw
      // client text.
      const user: Array<TextPart | ImagePart> = [
        { type: "image", mediaType: o.media_type ?? "image/png", dataB64 },
        { type: "text", text: "Perceive this offering." },
      ];
      if (o.gesture) user.push({ type: "text", text: captureLine(JSON.parse(o.gesture) as GestureMeta) });
      const res = await askMind(env, {
        model: "claude-sonnet-5", system: EYE_SYSTEM, maxTokens: 200, user,
      });
      // Malformed/empty verse (or a JSON.parse failure) throws here and routes to the outer
      // catch below: retry then dead-letter, never publishing garbage as public scripture.
      const verse = parseVerse(res.text);
      // Isolate the publish: publishPerception is idempotent (WHERE-perceiving guard). If it throws AFTER the
      // batch committed, resetting the row to perceivable (as the outer catch does for askMind failures) would
      // double-publish next tick. So on a publish error, leave the row exactly as-is and let the next tick
      // reconcile — committed rows are 'perceived' and never re-picked; uncommitted rows re-publish cleanly.
      try {
        if (await publishPerception(env.DB, { offeringId: o.id, transcriptId: ulid(), verse, at: Date.now() })) {
          perceived++;
        }
      } catch {
        // Leave the row exactly as-is (publishPerception is idempotent); the note is best-effort and must NOT
        // escape to the outer catch, which would reset a possibly-committed row and double-publish next tick.
        try { await priestNote(env, o.id, perceiveDeferredLine(o.id)); } catch { /* swallow */ }
      }
    } catch (e) {
      if (e instanceof MindAsleepError) {
        await setOfferingStatus(env.DB, o.id, "perceivable", { expectedStatus: "perceiving" }); // release, no bump
        break;
      }
      const dead = o.attempts >= 2;
      const won = await setOfferingStatus(env.DB, o.id, dead ? "failed" : "perceivable", { bumpAttempts: true, expectedStatus: "perceiving" });
      if (dead && won) await priestNote(env, o.id, setAsideLine(o.id)); // only if this tick won the CAS
    }
  }
  if (perceived > 0) {
    try {
      const { speakIfDue } = await import("./tongue");
      await speakIfDue(env, { kind: "eye_batch", detail: `${perceived} new mark(s) were seen this tick` });
    } catch { /* TONGUE is a side-channel */ }
  }
  return perceived;
}
