import type { Env } from "./env";
import { asleep } from "./budget";
import type { TranscriptRow } from "./db";

export async function getCodex(env: Env, cursor: string | null): Promise<Response> {
  let curTs: number | null = null, curId: string | null = null;
  if (cursor !== null) {
    const m = /^(\d+):([0-9A-HJKMNP-TV-Z]{26})$/.exec(cursor);
    if (!m) return Response.json({ error: "bad cursor" }, { status: 400 });
    curTs = Number(m[1]); curId = m[2];
  }
  const rows = (await env.DB.prepare(
    `SELECT * FROM transcripts
     WHERE (?1 IS NULL) OR (created_at < ?1) OR (created_at = ?1 AND id < ?2)
     ORDER BY created_at DESC, id DESC LIMIT 50`
  ).bind(curTs, curId).all<TranscriptRow>()).results;
  const last = rows[rows.length - 1];
  const next = rows.length === 50 ? `${last.created_at}:${last.id}` : null;
  return Response.json({ entries: rows, next });
}

export async function getState(env: Env): Promise<Response> {
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const communicants = await env.DB.prepare(
    `SELECT COUNT(DISTINCT wallet) AS n FROM offerings WHERE wallet IS NOT NULL AND created_at >= ?1`
  ).bind(since.getTime()).first<{ n: number }>();
  const launch = await env.DB.prepare(`SELECT value FROM config WHERE key = 'launch_at'`)
    .first<{ value: string }>();
  const sleeping = await asleep(env.DB);
  return Response.json({
    phase: "dormant",
    asleep: sleeping,
    countdown_to: Number(launch?.value ?? 0) || null,
    communicants_today: communicants?.n ?? 0,
    spend_state: sleeping ? "asleep" : "ok",
  });
}
