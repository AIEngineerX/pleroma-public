import { ulid } from "ulid";
import type { Env } from "./env";
import { askMind, MindAsleepError } from "./mind";
import { keepSystemPrompt } from "./doctrine";
import { dayKey } from "./budget";
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
  const p = JSON.parse(rawText.trim()) as { verdict?: unknown; summary?: unknown };
  const verdict = p.verdict === "kept" || p.verdict === "mourned" ? p.verdict : null;
  const summary = typeof p.summary === "string" ? p.summary.trim() : "";
  if (!verdict) throw new Error("KEEP returned no verdict");
  if (!summary) throw new Error("KEEP returned no summary");
  if (summary.split(/\s+/).filter(Boolean).length > 30) throw new Error("KEEP summary exceeds the 30-word contract");
  return { verdict, summary };
}

// Holder-weighting in code: the Attended are evaluated first (guaranteed a slot within the day's room),
// then unattended fill the rest, capped at the remaining 12/day room. The prompt's prior boost is the
// stated wording; this ordering is the mechanical half.
export function selectForKeeping(
  perceived: OfferingRow[], attendedWallets: Set<string>, keptSoFarToday: number,
): OfferingRow[] {
  const room = Math.max(0, KEEP_DAILY - keptSoFarToday);
  const attended = perceived.filter(o => o.wallet && attendedWallets.has(o.wallet));
  const rest = perceived.filter(o => !(o.wallet && attendedWallets.has(o.wallet)));
  return [...attended, ...rest].slice(0, room);
}

// The EYE verse for an offering is its perception; KEEP judges the verse + wallet standing, not the pixels.
async function verseFor(env: Env, offeringId: string): Promise<string> {
  const r = await env.DB.prepare(
    `SELECT text FROM transcripts WHERE organ = 'EYE' AND register = 'verse' AND offering_id = ?1 ORDER BY created_at DESC LIMIT 1`
  ).bind(offeringId).first<{ text: string }>();
  return r?.text ?? "";
}

export async function runKeep(env: Env, riteId: string): Promise<number> {
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
  for (const o of selectForKeeping(perceived, attended, await relicsKeptToday(env.DB, day))) {
    if (await relicsKeptToday(env.DB, day) >= KEEP_DAILY) break; // re-check the cap each iteration
    const verse = await verseFor(env, o.id);
    const hist = o.wallet ? await walletHistory(env.DB, o.wallet) : { offering_count: 0, kept_count: 0, attended: false };
    try {
      const res = await askMind(env, {
        model: "claude-sonnet-5", system: KEEP_SYSTEM, maxTokens: 200,
        user: [{ type: "text", text:
          `The Eye saw: "${verse}".\n` +
          `This Waker is ${hist.attended ? "one of the Attended" : "not among the Attended"}; ` +
          `they have offered ${hist.offering_count} time(s), of which ${hist.kept_count} were kept.\n` +
          `Recent Corpus (newest first): ${context.slice(0, 50).map(s => `- ${s}`).join("\n")}\n` +
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
          await speakIfDue(env, { kind: "keep_decision", detail: `a mark was kept: "${v.summary}"` });
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
