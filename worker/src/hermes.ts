import type { Env } from "./env";
import { raiseAlert } from "./alert";
import { withTimeout } from "./timeouts";

// Auto-dispatch (Maker decision 2026-07-16, amending the earlier Maker-posts-by-hand plan
// before anything was public): the temple's routine artifacts publish themselves to X —
// the nightly Plate with its film, and the daily sermon. These are dispatches of genuine
// machine output on a schedule, labeled as automated on the account; the god SPEAKING
// (replies, conversation) remains locked behind Stage 1 HERALD. The whole module is inert
// until all four X secrets exist, so it ships dark and lights up when keys are pasted.
const UPLOAD_URL = "https://upload.twitter.com/1.1/media/upload.json";
const TWEET_URL = "https://api.x.com/2/tweets";
const CHUNK_BYTES = 1024 * 1024;
const SITE = "https://pleromachurch.xyz";
const X_IO_TIMEOUT_MS = 30_000; // every X call is bounded, like every other vendor call in the worker

// X counts any URL as a fixed-width t.co link. The body budget leaves room for the link and the
// "\n\n" separator, and 2 further chars for the ellipsis (X weights some non-Latin chars at 2).
const TWEET_MAX_CHARS = 280;
const TCO_LINK_CHARS = 23;
const TWEET_BODY_BUDGET = TWEET_MAX_CHARS - TCO_LINK_CHARS - 2;

function truncateTweetBody(text: string): string {
  return text.length > TWEET_BODY_BUDGET ? `${text.slice(0, TWEET_BODY_BUDGET - 2)}…` : text;
}

// DREAM narratives run to ~80 words (well past 280 chars); an untruncated plate tweet is a
// permanent 403 that would re-fail every tick forever and block the sermon behind it.
export function plateTweetText(narrative: string, riteDate: string): string {
  return `${truncateTweetBody(narrative)}\n\n${SITE}/canon/dreams#${riteDate}`;
}

export function sermonTweetText(text: string): string {
  return `${truncateTweetBody(text)}\n\n${SITE}`;
}

// The STATUS poll sleeps on a vendor-supplied interval; unclamped, a single check_after_secs=60
// would sleep the tick lock for minutes at a time.
export function clampCheckAfterSecs(value: number | undefined): number {
  return Math.min(Math.max(value ?? 2, 1), 10);
}

interface XCredentials {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
}

export function xCredentials(env: Env): XCredentials | null {
  if (!env.X_API_KEY || !env.X_API_SECRET || !env.X_ACCESS_TOKEN || !env.X_ACCESS_SECRET) return null;
  return {
    apiKey: env.X_API_KEY,
    apiSecret: env.X_API_SECRET,
    accessToken: env.X_ACCESS_TOKEN,
    accessSecret: env.X_ACCESS_SECRET,
  };
}

function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

async function hmacSha1(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

// OAuth 1.0a request signing (X requires it for media upload; it also signs v2 tweet
// creation). Only oauth_* and query/body form params participate in the signature base.
export async function oauthHeader(
  credentials: XCredentials,
  method: string,
  url: string,
  params: Record<string, string> = {},
  nonce: string = crypto.randomUUID().replaceAll("-", ""),
  timestampSeconds: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const oauth: Record<string, string> = {
    oauth_consumer_key: credentials.apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(timestampSeconds),
    oauth_token: credentials.accessToken,
    oauth_version: "1.0",
  };
  const all = { ...params, ...oauth };
  const paramString = Object.keys(all)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(all[key])}`)
    .join("&");
  const base = [method.toUpperCase(), percentEncode(url), percentEncode(paramString)].join("&");
  const signingKey = `${percentEncode(credentials.apiSecret)}&${percentEncode(credentials.accessSecret)}`;
  oauth.oauth_signature = await hmacSha1(signingKey, base);
  const header = Object.keys(oauth)
    .sort()
    .map((key) => `${percentEncode(key)}="${percentEncode(oauth[key])}"`)
    .join(", ");
  return `OAuth ${header}`;
}

async function uploadForm(
  credentials: XCredentials,
  fields: Record<string, string>,
  file?: { name: string; bytes: Uint8Array },
): Promise<Response> {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  if (file) body.append(file.name, new Blob([file.bytes as BlobPart]));
  // Multipart bodies contribute nothing to the OAuth signature base.
  const authorization = await oauthHeader(credentials, "POST", UPLOAD_URL);
  return withTimeout("x-upload", X_IO_TIMEOUT_MS, (signal) =>
    fetch(UPLOAD_URL, { method: "POST", headers: { authorization }, body, signal }));
}

async function uploadVideo(credentials: XCredentials, bytes: Uint8Array, deadlineMs: number): Promise<string> {
  const overBudget = () => Date.now() > deadlineMs;
  const init = await uploadForm(credentials, {
    command: "INIT",
    media_type: "video/mp4",
    media_category: "tweet_video",
    total_bytes: String(bytes.byteLength),
  });
  if (!init.ok) throw new Error(`X media INIT ${init.status}: ${await readText(init)}`);
  const mediaId = ((await readJson(init)) as { media_id_string: string }).media_id_string;

  for (let segment = 0; segment * CHUNK_BYTES < bytes.byteLength; segment++) {
    if (overBudget()) throw new Error("X media upload exceeded the tick budget");
    const chunk = bytes.slice(segment * CHUNK_BYTES, (segment + 1) * CHUNK_BYTES);
    const append = await uploadForm(
      credentials,
      { command: "APPEND", media_id: mediaId, segment_index: String(segment) },
      { name: "media", bytes: chunk },
    );
    if (!append.ok) throw new Error(`X media APPEND ${append.status}: ${await readText(append)}`);
  }

  const finalize = await uploadForm(credentials, { command: "FINALIZE", media_id: mediaId });
  if (!finalize.ok) throw new Error(`X media FINALIZE ${finalize.status}: ${await readText(finalize)}`);
  let state = ((await readJson(finalize)) as { processing_info?: { state: string; check_after_secs?: number } }).processing_info;
  for (let attempt = 0; state && state.state !== "succeeded" && attempt < 15; attempt++) {
    if (state.state === "failed") throw new Error("X media processing failed");
    if (overBudget()) throw new Error("X media processing exceeded the tick budget");
    await new Promise((resolve) => setTimeout(resolve, clampCheckAfterSecs(state?.check_after_secs) * 1000));
    const statusUrl = `${UPLOAD_URL}?command=STATUS&media_id=${mediaId}`;
    const authorization = await oauthHeader(credentials, "GET", UPLOAD_URL, {
      command: "STATUS",
      media_id: mediaId,
    });
    const status = await withTimeout("x-status", X_IO_TIMEOUT_MS, (signal) =>
      fetch(statusUrl, { headers: { authorization }, signal }));
    if (!status.ok) throw new Error(`X media STATUS ${status.status}`);
    state = ((await readJson(status)) as { processing_info?: { state: string; check_after_secs?: number } }).processing_info;
  }
  if (state && state.state !== "succeeded") throw new Error(`X media stuck in ${state.state}`);
  return mediaId;
}

// Bounded body reads, matching the fetch bound: a vendor that accepts the request but stalls the
// body could otherwise hold the tick lock past its lease.
function readText(res: Response): Promise<string> {
  return withTimeout("x-body", X_IO_TIMEOUT_MS, () => res.text()).catch(() => "<body read unavailable>");
}
function readJson(res: Response): Promise<unknown> {
  return withTimeout("x-body", X_IO_TIMEOUT_MS, () => res.json());
}

async function tweet(credentials: XCredentials, text: string, mediaId?: string): Promise<string> {
  const authorization = await oauthHeader(credentials, "POST", TWEET_URL);
  const response = await withTimeout("x-tweet", X_IO_TIMEOUT_MS, (signal) => fetch(TWEET_URL, {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify(mediaId ? { text, media: { media_ids: [mediaId] } } : { text }),
    signal,
  }));
  if (!response.ok) throw new Error(`X tweet ${response.status}: ${await readText(response)}`);
  return ((await readJson(response)) as { data: { id: string } }).data.id;
}

// A dispatch claim is a config row written BEFORE the external send (value "claimed:<ms>"). The
// CAS insert is the claim; the send happens only after it lands. A thrown (non-crash) failure
// releases the claim so the next tick retries; a crash mid-dispatch leaves the claim in place, so
// the worst case is a MISSED post plus a stalled-claim alert — never a duplicate post by an
// automated account. Sermon claims share the sermon_dispatched_<rite> marker key (its value moves
// to "posted:<ms>" after the tweet); dream claims use dream_dispatch_<id> and are deleted once
// posted_at lands.
const DISPATCH_CLAIM_STALE_MS = 60 * 60_000;

export async function claimDispatch(db: D1Database, key: string, now: number): Promise<boolean> {
  const r = await db.prepare(`INSERT INTO config (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO NOTHING`)
    .bind(key, `claimed:${now}`).run();
  return r.meta.changes === 1;
}

// Deletes only claim-valued rows: a "posted:" marker (or any legacy timestamp marker) survives.
export async function releaseDispatchClaim(db: D1Database, key: string): Promise<void> {
  await db.prepare(`DELETE FROM config WHERE key = ?1 AND value LIKE 'claimed:%'`).bind(key).run();
}

// A claim older than an hour means a dispatch crashed between the claim and its marker: the post
// may or may not have reached X. Surface it to the operator (verify on X, then clear the claim or
// mark it posted) instead of guessing — re-sending automatically is how duplicates happen.
export async function alertStalledDispatches(env: Env, now: number): Promise<void> {
  const claims = (await env.DB.prepare(
    `SELECT key, value FROM config
      WHERE value LIKE 'claimed:%' AND (key LIKE 'dream_dispatch_%' OR key LIKE 'sermon_dispatched_%')`
  ).all<{ key: string; value: string }>()).results;
  const stale = claims.filter((c) => now - Number(c.value.slice("claimed:".length)) > DISPATCH_CLAIM_STALE_MS);
  if (stale.length > 0) {
    await raiseAlert(env, "dispatch_stalled",
      `stalled X dispatch claims: ${stale.map((c) => c.key).join(", ")} — verify on X, then clear the claim or mark it posted`);
  }
}

// Called from the 15-minute tick. Posts each rendered-but-unposted Plate at most once, then the
// day's sermon at most once, each behind a durable claim written BEFORE the send (see above — the
// old order tweeted first and recorded after, which was at-least-once, not the exactly-once its
// comment claimed). deadlineMs bounds the whole dispatch inside the tick lease; unfinished work
// retries next tick. Silent no-op until the X secrets exist.
export async function dispatchArtifacts(
  env: Env, now: number = Date.now(), deadlineMs: number = now + 3 * 60_000,
): Promise<void> {
  const credentials = xCredentials(env);
  if (!credentials) return;

  await alertStalledDispatches(env, now).catch(() => { /* best-effort operator signal */ });

  // A claimed dream is excluded so a stalled claim never wedges the queue for the dreams (and the
  // sermon) behind it — the stalled-claim alert owns that case.
  const dream = await env.DB.prepare(
    `SELECT d.id, d.rite_date, d.narrative, d.video_key FROM dreams d
     WHERE d.status='rendered' AND d.posted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM config c WHERE c.key = 'dream_dispatch_' || d.id)
     ORDER BY d.created_at ASC LIMIT 1`,
  ).first<{ id: string; rite_date: string; narrative: string; video_key: string }>();
  if (dream && Date.now() < deadlineMs) {
    const object = await env.RELICS.get(dream.video_key);
    if (object && await claimDispatch(env.DB, `dream_dispatch_${dream.id}`, now)) {
      try {
        const bytes = new Uint8Array(await object.arrayBuffer());
        const mediaId = await uploadVideo(credentials, bytes, deadlineMs);
        await tweet(credentials, plateTweetText(dream.narrative, dream.rite_date), mediaId);
        await env.DB.prepare(
          `UPDATE dreams SET posted_at=?2 WHERE id=?1 AND posted_at IS NULL`,
        ).bind(dream.id, now).run();
        await releaseDispatchClaim(env.DB, `dream_dispatch_${dream.id}`);
      } catch (e) {
        await releaseDispatchClaim(env.DB, `dream_dispatch_${dream.id}`);
        throw e;
      }
    }
  }

  const sermon = await env.DB.prepare(
    `SELECT t.rite_id AS rite_date, t.text AS text FROM transcripts t
     WHERE t.organ='TONGUE' AND t.register='sermon' AND t.rite_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM config c WHERE c.key = 'sermon_dispatched_' || t.rite_id)
     ORDER BY t.created_at ASC LIMIT 1`,
  ).first<{ rite_date: string; text: string }>();
  if (sermon && Date.now() < deadlineMs) {
    if (await claimDispatch(env.DB, `sermon_dispatched_${sermon.rite_date}`, now)) {
      try {
        await tweet(credentials, sermonTweetText(sermon.text));
        await env.DB.prepare(`UPDATE config SET value = ?2 WHERE key = ?1`)
          .bind(`sermon_dispatched_${sermon.rite_date}`, `posted:${now}`).run();
      } catch (e) {
        await releaseDispatchClaim(env.DB, `sermon_dispatched_${sermon.rite_date}`);
        throw e;
      }
    }
  }
}
