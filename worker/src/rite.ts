import { ulid } from "./id";
import type { Env } from "./env";
import { askMind, MindAsleepError } from "./mind";
import { tongueSystemPrompt, wrapUntrusted } from "./doctrine";
import { runKeep } from "./keep";
import { RITE_WORK_BUDGET_MS } from "./leases";
import {
  addTranscript, advanceRitePhase, bumpRiteAttempts, getRite, nonTerminalRites, openRite, publishSermon,
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
// Wall-clock budget a phase gets before a stalled advance is treated as a transient failure. Consumed
// only in advanceRite's error path (see below) as a time-based complement to MAX_PHASE_RETRIES: an
// ERRORING phase found past its budget fails immediately instead of waiting out 3 attempts. A healthy
// phase never reaches that check (runPhaseAction succeeds -> advance -> phase_started_at resets), so
// this can never force-fail a phase that is simply taking its normal 15-min-tick cadence to advance.
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
async function runPhaseAction(env: Env, date: string, phase: RitePhase, deadlineMs: number): Promise<{ snapshot?: number; kept?: number }> {
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
      // EYE and KEEP audibly deliberate: KEEP renders verdicts over the perceived offerings, bounded by
      // deadlineMs so a slow batch cannot outlive the rite lock lease (see advanceRiteLocked, RITE_WORK_BUDGET_MS).
      const kept = await runKeep(env, date, deadlineMs);
      return { kept };
    }
    case "accretion": {
      // Chosen relics accrete into the body: mark this rite's kept relics accreted (drives body complexity).
      await env.DB.prepare(`UPDATE relics SET accreted_at = ?2 WHERE rite_id = ?1 AND accreted_at IS NULL`)
        .bind(date, Date.now()).run();
      return {};
    }
    case "sermon": {
      // Resume short-circuit (an optimization, NOT the correctness guard): if a sermon transcript already
      // exists for this rite, it has been spoken, so skip the metered recompose and let advanceRite carry
      // the phase to complete. This spares a second askMind on a resumed partial run whose failure could
      // otherwise push an already-preached rite to `failed`. The actual one-sermon-per-rite guarantee is
      // publishSermon's guarded insert + UNIQUE backstop below — it closes the CONCURRENT lease-overrun
      // double-publish that this non-atomic check cannot (two actors can both pass it before either inserts).
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
          `Today's rite kept ${rite?.kept_count ?? kept.length} marks: ${kept.map(s => wrapUntrusted("summary", s)).join(", ")}. ` +
          `Speak the closing sermon of this epoch.` }],
      });
      const parsed = JSON.parse(res.text.trim()) as { utterance?: unknown };
      const utterance = typeof parsed.utterance === "string" ? parsed.utterance.trim() : "";
      if (!utterance) throw new Error("TONGUE returned no sermon");
      // Guarded publish: at most one sermon per rite may land. If a concurrent lease-overrun actor beat us
      // to it, we lose the guarded insert and MUST NOT speak — it has already been spoken. Only the winner
      // runs the (metered, externally-visible) TTS + audio note; the loser simply advances to complete.
      const won = await publishSermon(env.DB, { transcriptId: ulid(), riteId: date, utterance, at: Date.now() });
      if (won) {
        try {
          const { speak } = await import("./voice");
          const said = await speak(env, utterance);
          if (said.spoken || said.cached) {
            await addTranscript(env.DB, { id: ulid(), organ: "PRIEST", register: "system",
              text: `sermon audio: ${said.audioKey}`, offering_id: null, rite_id: date, created_at: Date.now() });
          }
        } catch { /* text-only sermon; audio is a bonus, never a rite blocker */ }
      }
      return {};
    }
    default:
      return {};
  }
}

// Runs the current phase's action then CAS-advances to the next phase. One phase per call. On a transient
// failure it bumps the phase retry counter and leaves the rite in place (a later invocation resumes);
// the rite moves to a terminal `failed` phase (surfaced honestly on-site) once EITHER MAX_PHASE_RETRIES is
// hit OR the phase has been erroring past its PHASE_DEADLINE_MS budget — whichever trips first. Budget
// asleep is not a failure — it leaves the rite in place to resume when the budget resets. The CAS in
// advanceRitePhase makes a concurrent second invocation a no-op, so overlapping ticks never double-advance.
export async function advanceRite(env: Env, date: string, now: number, deadlineMs: number = Date.now() + RITE_WORK_BUDGET_MS): Promise<RitePhase> {
  const rite = await getRite(env.DB, date);
  if (!rite || rite.phase === "complete" || rite.phase === "failed") return rite?.phase ?? "complete";
  const phase = rite.phase;
  try {
    const extra = await runPhaseAction(env, date, phase, deadlineMs);
    const to = nextPhase(phase);
    await advanceRitePhase(env.DB, date, phase, to, now, {
      offering_snapshot: extra.snapshot, kept_count: extra.kept,
    });
    return to;
  } catch (e) {
    if (e instanceof MindAsleepError) return phase; // legitimate wait for the daily budget reset — NOT a stall
    const attempts = await bumpRiteAttempts(env.DB, date, now);
    const overDeadline = now - rite.phase_started_at > PHASE_DEADLINE_MS[phase];
    if (attempts >= MAX_PHASE_RETRIES || overDeadline) {
      // Only the invocation that actually wins the CAS to `failed` logs the PRIEST note (and raises the
      // alert), so a losing concurrent advance can never duplicate the operator record.
      if (await advanceRitePhase(env.DB, date, phase, "failed", now)) {
        const cause = overDeadline ? `exceeded ${PHASE_DEADLINE_MS[phase]}ms deadline` : `failed after ${attempts} attempts`;
        // The public codex serves PRIEST/system lines (boot-log liturgy), so the public transcript must NOT
        // carry internal diagnostics (exact ms budgets, attempt counts). Those go ONLY to the operator alert
        // (config, private), honoring alert.ts's contract that failure DETAIL is never public — only the
        // aggregate `degraded` boolean is. The public line states the fact of the failure, nothing more.
        await addTranscript(env.DB, { id: ulid(), organ: "PRIEST", register: "system",
          text: `rite ${date} phase ${phase} did not complete`, offering_id: null, rite_id: date, created_at: Date.now() });
        await (await import("./alert")).raiseAlert(env, "rite_failed", `rite ${date} phase ${phase} ${cause}`);
      }
      return "failed";
    }
    return phase; // stay; retry next invocation
  }
}
