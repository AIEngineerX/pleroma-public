import type { Env } from "./env";
import { videoVendorFor, startRender, type VideoVendor } from "./imagine";
import { raiseAlert } from "./alert";

// The sermon's occasional moving plate (spec 2026-07-20): same async render lifecycle as the
// Dream's (kick -> poll -> R2), driven by the */15 tick. The row is created by hermes when a
// film-day sermon dispatch is composed; this module owns everything downstream. hermes'
// sermonFilmGate decides post-with-film / wait / text-only off the status written here.

const RENDER_DEADLINE_MS = 30 * 60_000;
const MAX_RENDER_ATTEMPTS = 4;
const KICK_WINDOW_MS = 48 * 60 * 60_000;

export function sermonFilmKey(riteDate: string): string { return `sermon/${riteDate}.mp4`; }

export async function renderSermonFilms(
  env: Env, now: number = Date.now(), vendor: VideoVendor | null = videoVendorFor(env),
): Promise<void> {
  if (!vendor) return;

  const pending = await env.DB.prepare(
    `SELECT rite_date, video_prompt FROM sermon_films
     WHERE status='pending' AND render_request_id IS NULL AND created_at > ?1 AND render_attempts < ?2
     ORDER BY created_at DESC LIMIT 1`
  ).bind(now - KICK_WINDOW_MS, MAX_RENDER_ATTEMPTS).first<{ rite_date: string; video_prompt: string }>();
  if (pending) {
    await env.DB.prepare(
      `UPDATE sermon_films SET render_attempts = render_attempts + 1 WHERE rite_date = ?1 AND status='pending'`
    ).bind(pending.rite_date).run();
    const requestId = await startRender(env, vendor, pending.video_prompt);
    if (requestId) {
      await env.DB.prepare(
        `UPDATE sermon_films SET status='rendering', render_request_id=?2, render_started_at=?3
         WHERE rite_date=?1 AND status='pending'`
      ).bind(pending.rite_date, requestId, now).run();
    }
  }

  const rendering = (await env.DB.prepare(
    `SELECT rite_date, render_request_id, render_started_at FROM sermon_films WHERE status='rendering'`
  ).all<{ rite_date: string; render_request_id: string | null; render_started_at: number | null }>()).results;
  for (const f of rendering) {
    if (!f.render_request_id) continue;
    const result = await vendor.poll(f.render_request_id).catch(() => null);
    if (!result) continue;
    if (result.state === "done" && result.bytes) {
      const key = sermonFilmKey(f.rite_date);
      await env.RELICS.put(key, result.bytes, { httpMetadata: { contentType: result.contentType ?? "video/mp4" } });
      await env.DB.prepare(
        `UPDATE sermon_films SET status='rendered', video_key=?2 WHERE rite_date=?1 AND status='rendering'`
      ).bind(f.rite_date, key).run();
    } else if (result.state === "failed" || result.state === "expired") {
      await env.DB.prepare(`UPDATE sermon_films SET status='failed' WHERE rite_date=?1 AND status='rendering'`)
        .bind(f.rite_date).run();
      await raiseAlert(env, "sermon_film_failed", `sermon film ${f.rite_date} render ${result.state}`);
    } else if (f.render_started_at !== null && now - f.render_started_at > RENDER_DEADLINE_MS) {
      await env.DB.prepare(`UPDATE sermon_films SET status='failed' WHERE rite_date=?1 AND status='rendering'`)
        .bind(f.rite_date).run();
      await raiseAlert(env, "sermon_film_failed", `sermon film ${f.rite_date} render timed out`);
    }
  }
}
