import type { Env } from "./env";

const AUDIO_KEY = /^audio\/[0-9a-f]{64}\.(mp3|wav)$/;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const IMMUTABLE = "public, max-age=31536000, immutable";

export async function serveAudio(env: Env, key: string): Promise<Response> {
  if (!AUDIO_KEY.test(key)) return new Response("bad key", { status: 400 });
  const obj = await env.RELICS.get(key);
  if (!obj) return new Response("not found", { status: 404 });
  return new Response(obj.body, {
    headers: { "content-type": obj.httpMetadata?.contentType ?? "audio/mpeg", "cache-control": IMMUTABLE },
  });
}

export async function serveOfferingImage(env: Env, id: string): Promise<Response> {
  if (!ULID.test(id)) return new Response("bad id", { status: 400 });
  // KEPT-ONLY. A relic (kept) is the only image the Body renders; a pre-verdict (perceived) or un-moderated
  // (pending/moderating/...) or rejected/failed id 404s exactly like a missing one, so no soon-to-be-mourned
  // or un-moderated mark can ever leak.
  const row = await env.DB.prepare(`SELECT status FROM offerings WHERE id = ?1`).bind(id).first<{ status: string }>();
  if (!row || row.status !== "kept") return new Response("not found", { status: 404 });
  const obj = await env.RELICS.get(`offerings/${id}`);
  if (!obj) return new Response("not found", { status: 404 });
  return new Response(obj.body, {
    headers: { "content-type": obj.httpMetadata?.contentType ?? "image/png", "cache-control": IMMUTABLE },
  });
}
