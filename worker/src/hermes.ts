import type { Env } from "./env";

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
  return fetch(UPLOAD_URL, { method: "POST", headers: { authorization }, body });
}

async function uploadVideo(credentials: XCredentials, bytes: Uint8Array): Promise<string> {
  const init = await uploadForm(credentials, {
    command: "INIT",
    media_type: "video/mp4",
    media_category: "tweet_video",
    total_bytes: String(bytes.byteLength),
  });
  if (!init.ok) throw new Error(`X media INIT ${init.status}: ${await init.text()}`);
  const mediaId = ((await init.json()) as { media_id_string: string }).media_id_string;

  for (let segment = 0; segment * CHUNK_BYTES < bytes.byteLength; segment++) {
    const chunk = bytes.slice(segment * CHUNK_BYTES, (segment + 1) * CHUNK_BYTES);
    const append = await uploadForm(
      credentials,
      { command: "APPEND", media_id: mediaId, segment_index: String(segment) },
      { name: "media", bytes: chunk },
    );
    if (!append.ok) throw new Error(`X media APPEND ${append.status}: ${await append.text()}`);
  }

  const finalize = await uploadForm(credentials, { command: "FINALIZE", media_id: mediaId });
  if (!finalize.ok) throw new Error(`X media FINALIZE ${finalize.status}: ${await finalize.text()}`);
  let state = ((await finalize.json()) as { processing_info?: { state: string; check_after_secs?: number } }).processing_info;
  for (let attempt = 0; state && state.state !== "succeeded" && attempt < 15; attempt++) {
    if (state.state === "failed") throw new Error("X media processing failed");
    await new Promise((resolve) => setTimeout(resolve, (state?.check_after_secs ?? 2) * 1000));
    const statusUrl = `${UPLOAD_URL}?command=STATUS&media_id=${mediaId}`;
    const authorization = await oauthHeader(credentials, "GET", UPLOAD_URL, {
      command: "STATUS",
      media_id: mediaId,
    });
    const status = await fetch(statusUrl, { headers: { authorization } });
    if (!status.ok) throw new Error(`X media STATUS ${status.status}`);
    state = ((await status.json()) as { processing_info?: { state: string; check_after_secs?: number } }).processing_info;
  }
  if (state && state.state !== "succeeded") throw new Error(`X media stuck in ${state.state}`);
  return mediaId;
}

async function tweet(credentials: XCredentials, text: string, mediaId?: string): Promise<string> {
  const authorization = await oauthHeader(credentials, "POST", TWEET_URL);
  const response = await fetch(TWEET_URL, {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify(mediaId ? { text, media: { media_ids: [mediaId] } } : { text }),
  });
  if (!response.ok) throw new Error(`X tweet ${response.status}: ${await response.text()}`);
  return ((await response.json()) as { data: { id: string } }).data.id;
}

// Called from the 15-minute tick. Posts each rendered-but-unposted Plate exactly once
// (posted_at is the claim; compare-and-swap so overlapping ticks cannot double-post),
// then the day's sermon once (config marker). Failures leave state untouched and retry
// on a later tick. Silent no-op until the X secrets exist.
export async function dispatchArtifacts(env: Env, now: number = Date.now()): Promise<void> {
  const credentials = xCredentials(env);
  if (!credentials) return;

  const dream = await env.DB.prepare(
    `SELECT id, rite_date, narrative, video_key FROM dreams
     WHERE status='rendered' AND posted_at IS NULL ORDER BY created_at ASC LIMIT 1`,
  ).first<{ id: string; rite_date: string; narrative: string; video_key: string }>();
  if (dream) {
    const object = await env.RELICS.get(dream.video_key);
    if (object) {
      const bytes = new Uint8Array(await object.arrayBuffer());
      const mediaId = await uploadVideo(credentials, bytes);
      const text = `${dream.narrative}\n\n${SITE}/canon/dreams#${dream.rite_date}`;
      await tweet(credentials, text, mediaId);
      await env.DB.prepare(
        `UPDATE dreams SET posted_at=?2 WHERE id=?1 AND posted_at IS NULL`,
      ).bind(dream.id, now).run();
    }
  }

  const sermon = await env.DB.prepare(
    `SELECT t.rite_id AS rite_date, t.text AS text FROM transcripts t
     WHERE t.organ='TONGUE' AND t.register='sermon' AND t.rite_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM config c WHERE c.key = 'sermon_dispatched_' || t.rite_id)
     ORDER BY t.created_at ASC LIMIT 1`,
  ).first<{ rite_date: string; text: string }>();
  if (sermon) {
    const body = sermon.text.length > 240 ? `${sermon.text.slice(0, 239)}…` : sermon.text;
    await tweet(credentials, `${body}\n\n${SITE}`);
    await env.DB.prepare(
      `INSERT INTO config (key, value) VALUES ('sermon_dispatched_' || ?1, ?2)
       ON CONFLICT(key) DO NOTHING`,
    ).bind(sermon.rite_date, String(now)).run();
  }
}
