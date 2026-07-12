import { ulid } from "ulid";
import type { Env } from "./env";
import { askMind, MindAsleepError } from "./mind";
import { dreamSystemPrompt } from "./doctrine";
import { getRite } from "./db";

const DREAM_SYSTEM = dreamSystemPrompt();
const STOPWORDS = new Set(["a", "an", "the", "of", "over", "in", "on", "and", "with", "into", "small", "large"]);

export interface RelicLite { id: string; wallet: string | null; summary: string }

function words(s: string): string[] {
  return s.toLowerCase().split(/[^a-z]+/).filter(w => w.length > 2 && !STOPWORDS.has(w));
}

// Deterministic cluster: find the significant word shared by the most relics; the seed is those relics.
// If nothing is shared, the seed is the whole set (the whole night is one dream). No Vectorize at Stage 0.
export function clusterRelics(relics: RelicLite[]): { seed: RelicLite[]; wakers: string[] } {
  const byWord = new Map<string, RelicLite[]>();
  for (const r of relics) {
    for (const w of new Set(words(r.summary))) {
      const arr = byWord.get(w) ?? []; arr.push(r); byWord.set(w, arr);
    }
  }
  let best: RelicLite[] = [];
  for (const arr of byWord.values()) if (arr.length > best.length) best = arr;
  const seed = best.length >= 2 ? best : relics;
  const wakers = [...new Set(seed.map(r => r.wallet).filter((w): w is string => !!w))];
  return { seed, wakers };
}

export async function composeDream(env: Env, date: string): Promise<string | null> {
  // Ordering: DREAM runs only after the rite for this date is complete.
  const rite = await getRite(env.DB, date);
  if (!rite || rite.phase !== "complete") return null;
  // Idempotent: one dream per rite date.
  const existing = await env.DB.prepare(`SELECT id FROM dreams WHERE rite_date = ?1`).bind(date).first<{ id: string }>();
  if (existing) return existing.id;

  const relics = (await env.DB.prepare(
    `SELECT id, wallet, summary FROM relics WHERE rite_id = ?1 ORDER BY kept_at LIMIT 12`
  ).bind(date).all<RelicLite>()).results;
  if (relics.length === 0) return null;

  const { seed, wakers } = clusterRelics(relics);
  try {
    const res = await askMind(env, {
      model: "claude-sonnet-5", system: DREAM_SYSTEM, maxTokens: 500,
      user: [{ type: "text", text: `Tonight's kept marks: ${seed.map(r => `"${r.summary}"`).join(", ")}. Dream.` }],
    });
    const p = JSON.parse(res.text.trim()) as { narrative?: unknown; video_prompt?: unknown };
    const narrative = typeof p.narrative === "string" ? p.narrative.trim() : "";
    const videoPrompt = typeof p.video_prompt === "string" ? p.video_prompt.trim() : "";
    if (!narrative || !videoPrompt) throw new Error("DREAM returned an incomplete dream");
    const id = ulid();
    const dreamStmt = env.DB.prepare(
      `INSERT INTO dreams (id, rite_date, narrative, video_prompt, wakers, status, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'composed', ?6) ON CONFLICT(rite_date) DO NOTHING`
    ).bind(id, date, narrative, videoPrompt, JSON.stringify(wakers), Date.now());
    // The plate: a DREAM/verse transcript printed into the codex. Inlined (mirrors addTranscript) so it
    // commits in the SAME batch as the dreams row — a composed dream can never lack its codex plate.
    const plateStmt = env.DB.prepare(
      `INSERT INTO transcripts (id, organ, register, text, offering_id, rite_id, created_at)
       VALUES (?1, 'DREAM', 'verse', ?2, NULL, ?3, ?4)`
    ).bind(ulid(), narrative, date, Date.now());
    await env.DB.batch([dreamStmt, plateStmt]);
    return id;
  } catch (e) {
    if (e instanceof MindAsleepError) return null;
    return null; // never fabricate a dream; the nightly cron retries next run
  }
}
