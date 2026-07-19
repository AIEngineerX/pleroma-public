import type { Env } from "./env";
import { ulid } from "./id";
import { checkRate, WINDOW_MS } from "./ratelimit";
import { moderateText, ModerationUnavailableError } from "./moderation";
import { MindAsleepError } from "./mind";

export const MAX_APOCRYPHA_LENGTH = 500;
export const APOCRYPHA_IP_LIMIT = 3; // verses per source IP per minute

// Apocrypha ("verses written by Wakers, not by the god; kept separate from the Canon" --
// DOCTRINE.md Lexicon) is anonymous-only and moderated synchronously: unlike an offering (which
// the Eye perceives on its own later cadence), a verse either publishes now or is rejected now --
// there is no pending state and no stored record of a rejection, matching the offering pipeline's
// own stance of never keeping what moderation refused.
export async function handleApocryphaSubmit(env: Env, body: unknown, clientIp: string): Promise<Response> {
  if (typeof body !== "object" || body === null) return Response.json({ error: "bad request" }, { status: 400 });
  const rawText = (body as Record<string, unknown>).text;
  if (typeof rawText !== "string") return Response.json({ error: "a verse is required" }, { status: 400 });
  const text = rawText.trim();
  if (text.length === 0) return Response.json({ error: "a verse is required" }, { status: 400 });
  if (text.length > MAX_APOCRYPHA_LENGTH) {
    return Response.json({ error: `too long (max ${MAX_APOCRYPHA_LENGTH} characters)` }, { status: 413 });
  }

  const now = Date.now();
  if (!(await checkRate(env.DB, `apocrypha:ip:${clientIp}`, now, WINDOW_MS, APOCRYPHA_IP_LIMIT))) {
    return Response.json({ error: "too many verses; rest a moment" }, { status: 429 });
  }

  let verdict;
  try {
    verdict = await moderateText(env, text);
  } catch (e) {
    if (e instanceof MindAsleepError) return Response.json({ error: "asleep; try again later" }, { status: 503 });
    if (e instanceof ModerationUnavailableError) {
      return Response.json({ error: "could not be read right now; try again" }, { status: 503 });
    }
    throw e;
  }
  if (verdict.verdict === "reject") return Response.json({ error: "not accepted" }, { status: 422 });

  const id = await commitApocrypha(env, text, now);
  return Response.json({ id, status: "published" }, { status: 201 });
}

// Split out so the allow-path's own effect (a real row appears, listable, exactly once) is
// directly testable without a live ANTHROPIC_API_KEY to drive moderateText() to "allow" --
// mirrors eye.ts's own promote-before-perceivable tests, which exercise the allow branch's
// composed pieces directly for the same reason (see eye.test.ts).
export async function commitApocrypha(env: Env, text: string, now: number): Promise<string> {
  const id = ulid();
  await env.DB.prepare(`INSERT INTO apocrypha (id, text, created_at) VALUES (?1, ?2, ?3)`)
    .bind(id, text, now)
    .run();
  return id;
}

export interface ApocryphaEntry { id: string; text: string; created_at: number }

export async function getApocrypha(env: Env, cursor: string | null): Promise<Response> {
  let curCreated: number | null = null, curId: string | null = null;
  if (cursor !== null) {
    const m = /^(\d{1,15}):([0-9A-HJKMNP-TV-Z]{26})$/.exec(cursor);
    if (!m) return Response.json({ error: "bad cursor" }, { status: 400 });
    curCreated = Number(m[1]); curId = m[2];
  }
  const rows = (await env.DB.prepare(
    `SELECT id, text, created_at FROM apocrypha
     WHERE (?1 IS NULL) OR (created_at < ?1) OR (created_at = ?1 AND id < ?2)
     ORDER BY created_at DESC, id DESC LIMIT 50`
  ).bind(curCreated, curId).all<ApocryphaEntry>()).results;
  const last = rows[rows.length - 1];
  const next = rows.length === 50 ? `${last.created_at}:${last.id}` : null;
  return Response.json({ entries: rows, next });
}
