import { ulid } from "ulid";
import type { Env } from "./env";
import { askMind, MindAsleepError } from "./mind";
import { dreamSystemPrompt } from "./doctrine";
import { getRite } from "./db";
import { videoVendorFor, startRender, type VideoVendor } from "./imagine";
import { raiseAlert } from "./alert";

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

// --- DREAM video render (G1) --------------------------------------------------------------------
// The async render lifecycle, driven by the */15 tick (index.ts:runTick) so it can span the minutes a
// Grok Imagine clip takes. composeDream stays the sole writer of the durable dream text + plate; this
// function owns everything downstream, so a dream can never lack its plate waiting on a video. No-op
// when video is off (VIDEO_VENDOR unset) — that is exactly the pre-G1 text-only behavior.

const RENDER_DEADLINE_MS = 30 * 60_000;      // a pending render older than this is given up on
const MAX_RENDER_ATTEMPTS = 4;               // lifetime submit attempts before a dream stays text-only
const KICK_WINDOW_MS = 48 * 60 * 60_000;     // only recent composed dreams are eligible to render

export function dreamVideoKey(id: string): string { return `dream/${id}.mp4`; }

export async function renderDreams(
  env: Env, now: number = Date.now(), vendor: VideoVendor | null = videoVendorFor(env),
): Promise<void> {
  if (!vendor) return;

  // Kick: submit a render for the freshest composed dream not yet started. Bounded to the last 48h so
  // turning the vendor on never backfills the whole archive; retriable up to MAX_RENDER_ATTEMPTS.
  const composed = await env.DB.prepare(
    `SELECT id, video_prompt FROM dreams
     WHERE status='composed' AND render_request_id IS NULL AND created_at > ?1 AND render_attempts < ?2
     ORDER BY created_at DESC LIMIT 1`
  ).bind(now - KICK_WINDOW_MS, MAX_RENDER_ATTEMPTS).first<{ id: string; video_prompt: string }>();
  if (composed) {
    // Bump attempts durably BEFORE the network submit: a crash between start() and the status update can
    // then re-select this row at most MAX_RENDER_ATTEMPTS times total, bounding any double-submit.
    await env.DB.prepare(`UPDATE dreams SET render_attempts = render_attempts + 1 WHERE id = ?1 AND status='composed'`).bind(composed.id).run();
    const requestId = await startRender(env, vendor, composed.video_prompt);
    if (requestId) {
      await env.DB.prepare(
        `UPDATE dreams SET status='rendering', render_request_id=?2, render_started_at=?3 WHERE id=?1 AND status='composed'`
      ).bind(composed.id, requestId, now).run();
    }
    // requestId null (cap reached / submit failed pre-acceptance): stays 'composed', retried next tick.
  }

  // Poll: advance rendering dreams. done -> R2 mp4 + rendered; failed/expired/deadline -> render_failed.
  const rendering = (await env.DB.prepare(
    `SELECT id, render_request_id, render_started_at FROM dreams WHERE status='rendering'`
  ).all<{ id: string; render_request_id: string | null; render_started_at: number | null }>()).results;
  for (const d of rendering) {
    if (!d.render_request_id) continue;
    // transient poll error -> null: leave rendering, retry next tick (the deadline below is the backstop)
    const result = await vendor.poll(d.render_request_id).catch(() => null);
    if (!result) continue;
    if (result.state === "done" && result.bytes) {
      const key = dreamVideoKey(d.id);
      await env.RELICS.put(key, result.bytes, { httpMetadata: { contentType: result.contentType ?? "video/mp4" } });
      // CAS on status so a concurrent/duplicate poll can't double-write; the R2 put above is idempotent (same key).
      await env.DB.prepare(`UPDATE dreams SET status='rendered', video_key=?2 WHERE id=?1 AND status='rendering'`).bind(d.id, key).run();
    } else if (result.state === "failed" || result.state === "expired") {
      await env.DB.prepare(`UPDATE dreams SET status='render_failed' WHERE id=?1 AND status='rendering'`).bind(d.id).run();
      await raiseAlert(env, "dream_render_failed", `dream ${d.id} render ${result.state}`);
    } else if (d.render_started_at !== null && now - d.render_started_at > RENDER_DEADLINE_MS) {
      await env.DB.prepare(`UPDATE dreams SET status='render_failed' WHERE id=?1 AND status='rendering'`).bind(d.id).run();
      await raiseAlert(env, "dream_render_failed", `dream ${d.id} render timed out`);
    }
  }
}
