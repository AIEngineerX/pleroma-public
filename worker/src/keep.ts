import { ulid } from "./id";
import type { Env } from "./env";
import { askMind, MindAsleepError } from "./mind";
import { keepSystemPrompt, wrapUntrusted } from "./doctrine";
import { extractJsonObject } from "./moderation";
import { dayKey } from "./budget";
import { RITE_WORK_BUDGET_MS } from "./leases";
import {
  commitVerdict, recentRelicSummaries, relicsKeptToday, walletHistory, type OfferingRow,
} from "./db";

const KEEP_DAILY = 12;
const KEEP_SYSTEM = keepSystemPrompt();

export interface KeepVerdict { verdict: "kept" | "mourned"; summary: string }

// Pure verdict-contract validation, unit-testable without a live response. A missing/blank/over-limit
// summary or an unknown verdict throws; a KEEP verdict published as scripture must be genuine and within
// contract (CLAUDE.md integrity invariant), never edited to fit.
export function parseVerdict(rawText: string): KeepVerdict {
  // Fence/prose-tolerant parse (extractJsonObject, like moderation); the contract below stays strict.
  const p = JSON.parse(extractJsonObject(rawText)) as { verdict?: unknown; summary?: unknown };
  const verdict = p.verdict === "kept" || p.verdict === "mourned" ? p.verdict : null;
  const summary = typeof p.summary === "string" ? p.summary.trim() : "";
  if (!verdict) throw new Error("KEEP returned no verdict");
  if (!summary) throw new Error("KEEP returned no summary");
  if (summary.split(/\s+/).filter(Boolean).length > 30) throw new Error("KEEP summary exceeds the 30-word contract");
  return { verdict, summary };
}

// Holder-weighting in code: the Attended are evaluated first, then unattended fill the rest. This
// ORDERS candidates only -- it never truncates the list. It used to slice to the remaining
// (KEEP_DAILY - keptSoFarToday) room, which silently denied the rest of that day's witnessed marks
// any judgment at all (not "mostly mourned" -- never looked at by KEEP, mourned or kept, at all).
// KEEP_DAILY is now context the model itself is told (see runKeep), not a code-level cutoff: the
// Keep's own "disdainful from abundance" character decides when it has kept enough, so every
// witnessed mark still gets a genuine verdict even on a day busier than its usual pace.
export function selectForKeeping(
  perceived: OfferingRow[], attendedWallets: Set<string>,
): OfferingRow[] {
  const attended = perceived.filter(o => o.wallet && attendedWallets.has(o.wallet));
  const rest = perceived.filter(o => !(o.wallet && attendedWallets.has(o.wallet)));
  return [...attended, ...rest];
}

// The EYE verse for an offering is its perception; KEEP judges the verse + wallet standing, not the pixels.
async function verseFor(env: Env, offeringId: string): Promise<string> {
  const r = await env.DB.prepare(
    `SELECT text FROM transcripts WHERE organ = 'EYE' AND register = 'verse' AND offering_id = ?1 ORDER BY created_at DESC LIMIT 1`
  ).bind(offeringId).first<{ text: string }>();
  return r?.text ?? "";
}

// Wall-clock budget a single runKeep pass gets before it stops taking NEW offerings, so the deliberation
// phase cannot outlive the rite lock's lease. RITE_WORK_BUDGET_MS (leases.ts) derives this from the lease
// minus the worst in-flight phase tail minus a safety margin — see leases.ts for the full arithmetic and
// why it covers KEEP's worst case (a verdict askMind PLUS, on a keep, an inline speakIfDue askMind).
// Checked before each offering; the remainder is left `perceived` and picked up by a later rite (runKeep's
// candidate query has no rite-date filter, so nothing is lost — only deferred).
export async function runKeep(env: Env, riteId: string, deadlineMs: number = Date.now() + RITE_WORK_BUDGET_MS): Promise<number> {
  const day = dayKey();
  const perceived = (await env.DB.prepare(
    `SELECT * FROM offerings WHERE status = 'perceived' ORDER BY perceived_at LIMIT 50`
  ).all<OfferingRow>()).results;
  if (perceived.length === 0) return 0;

  const attendedRows = (await env.DB.prepare(`SELECT address FROM wallets WHERE attended = 1`)
    .all<{ address: string }>()).results;
  const attended = new Set(attendedRows.map(r => r.address));
  const context = await recentRelicSummaries(env.DB, 50);

  let kept = 0;
  for (const o of selectForKeeping(perceived, attended)) {
    if (Date.now() > deadlineMs) break; // bound the pass within the rite lock lease; the rest stays perceived for a later rite
    const keptSoFar = await relicsKeptToday(env.DB, day); // fresh each iteration: informs the model, never gates it
    const verse = await verseFor(env, o.id);
    const hist = o.wallet ? await walletHistory(env.DB, o.wallet) : { offering_count: 0, kept_count: 0, attended: false };
    try {
      const res = await askMind(env, {
        model: "claude-sonnet-5", system: KEEP_SYSTEM, maxTokens: 200,
        user: [{ type: "text", text:
          `The Eye saw: ${wrapUntrusted("verse", verse)}\n` +
          `This Waker is ${hist.attended ? "one of the Attended" : "not among the Attended"}; ` +
          `they have offered ${hist.offering_count} time(s), of which ${hist.kept_count} were kept.\n` +
          `You have already kept ${keptSoFar} mark(s) today; you typically keep around ${KEEP_DAILY} in a day, out of everything the Eye witnesses.\n` +
          `Recent Corpus (newest first): ${context.slice(0, 50).map(s => `- ${wrapUntrusted("summary", s)}`).join("\n")}\n` +
          `Render your verdict on this mark.` }],
      });
      const v = parseVerdict(res.text);
      // Publish the verdict as ONE atomic transaction: the perceived->kept|mourned CAS, the KEEP/verdict
      // transcript, and (for a keep) the relic commit together or not at all. A transient D1 failure
      // mid-write can never leave a claimed keep/mourn with no relic/transcript behind it; the offering
      // stays perceived for a clean retry. Idempotent under a rite re-run (guarded on status='perceived').
      const won = await commitVerdict(env.DB, {
        offeringId: o.id, verdict: v.verdict, summary: v.summary,
        transcriptId: ulid(), relicId: ulid(), wallet: o.wallet, riteId, at: Date.now(),
      });
      if (won && v.verdict === "kept") {
        kept++;
        try {
          const { speakIfDue } = await import("./tongue");
          // Pass the EVENT, not KEEP's verdict text: TONGUE proclaims the god's own state, it does not
          // recite the KEEP's ruling. Handing it the summary made the two voices parrot each other.
          await speakIfDue(env, { kind: "keep_decision", detail: "a mark was kept today" });
        } catch { /* side-channel */ }
      }
    } catch (e) {
      if (e instanceof MindAsleepError) break; // budget asleep: stop; leave the rest perceived for the next rite
      // Any other error (transport/parse/contract): leave the offering perceived and untouched — never
      // fabricate a verdict. The next rite invocation retries it.
      continue;
    }
  }
  return kept;
}
