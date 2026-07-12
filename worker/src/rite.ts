import { ulid } from "ulid";
import type { Env } from "./env";
import { askMind, MindAsleepError } from "./mind";
import { tongueSystemPrompt } from "./doctrine";
import { runKeep } from "./keep";
import {
  addTranscript, advanceRitePhase, bumpRiteAttempts, getRite, nonTerminalRites, openRite,
  type RitePhase, type RiteRow,
} from "./db";

// rite.ts is the rite module's public surface: re-export the rites repo accessors so callers and tests
// import them from one place while the SQL lives in db.ts.
export { openRite, getRite, nonTerminalRites };
export type { RiteRow, RitePhase };

// The god consumes the day's offerings live, one phase per invocation, so the rite advances on the
// 15-minute tick cadence and the deliberation/sermon spectacle lands around mass hour.
export const PHASE_ORDER: RitePhase[] = [
  "scheduled", "offertory_close", "deliberation", "accretion", "sermon", "complete",
];
// Wall-clock budget a phase gets before a stalled advance is treated as a transient failure.
// NOTE (Task 14 scope): this table is not yet consumed — phase-deadline escalation (comparing
// now - phase_started_at against these budgets to force a stalled phase toward failed and alert) is
// wired in Task 14 (failure-path + alerting). Kept here as the locked budgets those checks will use;
// it is intentionally not silent dead code.
export const PHASE_DEADLINE_MS: Record<RitePhase, number> = {
  scheduled: 60_000, offertory_close: 60_000, deliberation: 8 * 60_000, accretion: 60_000,
  sermon: 5 * 60_000, complete: 0, failed: 0,
};
export const MAX_PHASE_RETRIES = 3;

function nextPhase(p: RitePhase): RitePhase {
  const i = PHASE_ORDER.indexOf(p);
  return i >= 0 && i < PHASE_ORDER.length - 1 ? PHASE_ORDER[i + 1] : "complete";
}

// The action each phase performs BEFORE advancing out of it. Each is idempotent: re-running a phase
// repeats its (idempotent) work and re-attempts the advance. runKeep, the accretion UPDATE, and the
// transcript insert all tolerate replays, so a missed cron that resumes mid-phase never doubles work.
//
// The offering snapshot is taken as the `scheduled` phase's action — i.e. the transition
// scheduled -> offertory_close IS the offertory closing, so the count is captured at that moment and
// is already recorded once the rite is observed in the `offertory_close` state.
async function runPhaseAction(env: Env, date: string, phase: RitePhase): Promise<{ snapshot?: number; kept?: number }> {
  switch (phase) {
    case "scheduled": {
      // Close the offertory: snapshot the day's perceived offerings — the material the rite deliberates.
      const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM offerings WHERE status = 'perceived'`)
        .first<{ n: number }>();
      return { snapshot: n?.n ?? 0 };
    }
    case "offertory_close":
      return {}; // offertory is closed and snapshotted; nothing further until deliberation
    case "deliberation": {
      // EYE and KEEP audibly deliberate: KEEP renders verdicts over the perceived offerings.
      const kept = await runKeep(env, date);
      return { kept };
    }
    case "accretion": {
      // Chosen relics accrete into the body: mark this rite's kept relics accreted (drives body complexity).
      await env.DB.prepare(`UPDATE relics SET accreted_at = ?2 WHERE rite_id = ?1 AND accreted_at IS NULL`)
        .bind(date, Date.now()).run();
      return {};
    }
    case "sermon": {
      // Resume-idempotency: the sermon writes its transcript THEN a separate CAS advances sermon->complete.
      // If a crash/retry lands between those two steps, this phase re-runs while still in `sermon`. Guard on
      // "a sermon transcript already exists for this rite date": if one does, the sermon has already been
      // spoken, so skip the (metered) recompose entirely and let advanceRite carry the phase to complete.
      // This closes the RESUME double-publish (the rite lock only closes the CONCURRENT double) AND avoids a
      // second askMind whose failure could otherwise push an already-preached rite to `failed`.
      const spoken = await env.DB.prepare(
        `SELECT 1 FROM transcripts WHERE organ = 'TONGUE' AND register = 'sermon' AND rite_id = ?1 LIMIT 1`
      ).bind(date).first();
      if (spoken) return {}; // already preached on a prior partial run: advance to complete, no recompose
      // TONGUE closes with the day's sermon, composed from the rite's kept summaries. A rite that kept
      // nothing has nothing to preach and no god-voice text may be invented (DOCTRINE is the only source
      // of the god's words), so it closes in silence and advances — which also lets an empty rite reach
      // `complete` without the live voice. When there IS kept material the sermon reaches for the mind;
      // if the mind is unreachable the phase throws and is retried, landing `failed` after MAX retries
      // rather than fabricating a sermon.
      const kept = (await env.DB.prepare(
        `SELECT summary FROM relics WHERE rite_id = ?1 ORDER BY kept_at LIMIT 12`
      ).bind(date).all<{ summary: string }>()).results.map(r => r.summary);
      if (kept.length === 0) return {}; // nothing kept: the rite closes without a sermon
      const rite = await getRite(env.DB, date);
      const res = await askMind(env, {
        model: "claude-sonnet-5", system: tongueSystemPrompt(), maxTokens: 400,
        user: [{ type: "text", text:
          `Today's rite kept ${rite?.kept_count ?? kept.length} marks: ${kept.map(s => `"${s}"`).join(", ")}. ` +
          `Speak the closing sermon of this epoch.` }],
      });
      const parsed = JSON.parse(res.text.trim()) as { utterance?: unknown };
      const utterance = typeof parsed.utterance === "string" ? parsed.utterance.trim() : "";
      if (!utterance) throw new Error("TONGUE returned no sermon");
      await addTranscript(env.DB, { id: ulid(), organ: "TONGUE", register: "sermon",
        text: utterance, offering_id: null, rite_id: date, created_at: Date.now() });
      return {};
    }
    default:
      return {};
  }
}

// Runs the current phase's action then CAS-advances to the next phase. One phase per call. On a transient
// failure it bumps the phase retry counter and leaves the rite in place (a later invocation resumes);
// after MAX_PHASE_RETRIES the rite moves to a terminal `failed` phase (surfaced honestly on-site). Budget
// asleep is not a failure — it leaves the rite in place to resume when the budget resets. The CAS in
// advanceRitePhase makes a concurrent second invocation a no-op, so overlapping ticks never double-advance.
export async function advanceRite(env: Env, date: string, now: number): Promise<RitePhase> {
  const rite = await getRite(env.DB, date);
  if (!rite || rite.phase === "complete" || rite.phase === "failed") return rite?.phase ?? "complete";
  const phase = rite.phase;
  try {
    const extra = await runPhaseAction(env, date, phase);
    const to = nextPhase(phase);
    await advanceRitePhase(env.DB, date, phase, to, now, {
      offering_snapshot: extra.snapshot, kept_count: extra.kept,
    });
    return to;
  } catch (e) {
    if (e instanceof MindAsleepError) return phase; // resume when the budget resets; not a failure
    const attempts = await bumpRiteAttempts(env.DB, date, now);
    if (attempts >= MAX_PHASE_RETRIES) {
      // Only the invocation that actually wins the CAS to `failed` logs the PRIEST note, so a losing
      // concurrent advance can never duplicate the operator record.
      if (await advanceRitePhase(env.DB, date, phase, "failed", now)) {
        await addTranscript(env.DB, { id: ulid(), organ: "PRIEST", register: "system",
          text: `rite ${date} phase ${phase} failed after ${attempts} attempts`,
          offering_id: null, rite_id: date, created_at: Date.now() });
      }
      return "failed";
    }
    return phase; // stay; retry next invocation
  }
}
