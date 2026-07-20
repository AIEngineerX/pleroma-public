import { ulid } from "./id";
import type { Env } from "./env";
import { nonceIsFresh } from "./nonce";
import { verifyOffering } from "./signature";
import { commitOffering, offeringBySha } from "./db";
import { checkRate, WINDOW_MS, WALLET_LIMIT, IP_LIMIT } from "./ratelimit";

const MAX_BYTES = 512 * 1024;
const TYPES = new Set(["image/png", "image/webp"]);

// The web Threshold's honest gesture capture (Task 6, grown-lineage-marks): every field is a
// channel the client's own hand actually produced, but the client is untrusted, so every value
// is range-checked here before it ever rides an offering or reaches EYE. Any single violation
// discards the WHOLE struct (return null) rather than the individual field -- the offering is
// still accepted; gesture metadata is simply absent, never a reason to reject a genuine mark.
export interface GestureMeta {
  holdMs: number;
  travelPx: number;
  tremorAmp: number;
  knockSig: number[];
  approachSpreadPx: number;
  pigmentIntensity: number;
  substrateRelicId: string | null;
  substrateOwn: boolean;
}

// Crockford base32 (no I/L/O/U), 26 chars -- the ULID shape relic ids are minted in (see id.ts).
const RELIC_ID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function inRange(n: unknown, min: number, max: number): boolean {
  return typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
}

export function clampGesture(raw: string | null): GestureMeta | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const g = parsed as Record<string, unknown>;

  if (!inRange(g.holdMs, 0, 20_000)) return null;
  if (!inRange(g.travelPx, 0, 1000)) return null;
  if (!inRange(g.tremorAmp, 0, 10)) return null;
  if (!Array.isArray(g.knockSig) || g.knockSig.length > 8 || !g.knockSig.every(n => inRange(n, 0, 10))) return null;
  if (!inRange(g.approachSpreadPx, 0, 2000)) return null;
  if (!inRange(g.pigmentIntensity, 0, 1)) return null;
  if (g.substrateRelicId !== null && !(typeof g.substrateRelicId === "string" && RELIC_ID_RE.test(g.substrateRelicId))) return null;
  if (typeof g.substrateOwn !== "boolean") return null;

  return {
    holdMs: g.holdMs as number,
    travelPx: g.travelPx as number,
    tremorAmp: g.tremorAmp as number,
    knockSig: g.knockSig as number[],
    approachSpreadPx: g.approachSpreadPx as number,
    pigmentIntensity: g.pigmentIntensity as number,
    substrateRelicId: g.substrateRelicId as string | null,
    substrateOwn: g.substrateOwn,
  };
}

export async function handleOffering(env: Env, form: FormData, clientIp: string): Promise<Response> {
  const image = form.get("image");
  if (!(image instanceof File) || !TYPES.has(image.type)) {
    return Response.json({ error: "image required (png or webp)" }, { status: 400 });
  }
  if (image.size > MAX_BYTES) {
    return Response.json({ error: "image too large" }, { status: 413 });
  }
  const bytes = new Uint8Array(await image.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");

  if (await offeringBySha(env.DB, sha256)) {
    return Response.json({ error: "already offered" }, { status: 409 });
  }

  // Empty/whitespace-only wallet/sig fields count as anonymous: normalize to null.
  const rawWallet = form.get("wallet")?.toString().trim();
  const rawSig = form.get("sig")?.toString().trim();
  const wallet = rawWallet ? rawWallet : null;
  const sig = rawSig ? rawSig : null;
  let nonce = "";
  if (wallet || sig) {
    nonce = form.get("nonce")?.toString() ?? "";
    const expiresAtMs = Number(form.get("expires_at") ?? 0);
    // A Solana address is <=44 base58 chars and an ed25519 signature <=88; the nonce is 32 hex. Reject anything
    // far larger before the O(n^2) base58 decode runs, so an oversized field can't amplify into a CPU-exhaustion.
    if ((wallet && wallet.length > 64) || (sig && sig.length > 128) || nonce.length > 64) {
      return Response.json({ error: "signature rejected" }, { status: 400 });
    }
    const sigOk = wallet && sig &&
      verifyOffering({ wallet, sigB58: sig, sha256hex: sha256, nonce, expiresAtMs });
    if (!sigOk) return Response.json({ error: "signature rejected" }, { status: 401 });
    if (!(await nonceIsFresh(env.DB, nonce))) {
      return Response.json({ error: "signature rejected" }, { status: 401 });
    }
  }

  // Intake priest: per-IP and (for signed offerings) per-wallet caps in a 60s fixed window, checked
  // before the R2 write so a flood never touches storage. Anonymous floods are capped by IP; signed
  // floods by wallet.
  const now = Date.now();
  if (!(await checkRate(env.DB, `ip:${clientIp}`, now, WINDOW_MS, IP_LIMIT))) {
    return Response.json({ error: "too many offerings; rest a moment" }, { status: 429 });
  }
  if (wallet && !(await checkRate(env.DB, `wallet:${wallet}`, now, WINDOW_MS, WALLET_LIMIT))) {
    return Response.json({ error: "too many offerings; rest a moment" }, { status: 429 });
  }

  // Never trust the client's raw gesture string; store only the re-serialized, clamped struct.
  // A hostile/malformed payload clamps to null -- the offering below is still accepted.
  const rawGesture = form.get("gesture");
  const clampedGesture = clampGesture(typeof rawGesture === "string" ? rawGesture : null);

  const id = ulid();
  // Uploads are quarantined until a moderation ALLOW promotes them to offerings/ (see
  // eye.ts). Rejects purge the quarantine object and are never kept in permanent R2. The R2
  // write happens BEFORE any D1 mutation, so a put failure touches no nonce/offering state.
  const key = `quarantine/${id}`;
  await env.RELICS.put(key, bytes, { httpMetadata: { contentType: image.type } });
  try {
    // Atomic: the offering insert and (for signed offerings) the wallet's offering_count bump
    // commit together in one D1 batch, so the count can never drift from the accepted offering.
    await commitOffering(env.DB, {
      id, wallet, sig, image_key: key, sha256, media_type: image.type,
      status: "pending", attempts: 0, created_at: Date.now(), perceived_at: null,
      nonce: wallet ? nonce : null,
      gesture: clampedGesture ? JSON.stringify(clampedGesture) : null,
    }, wallet);
  } catch (e) {
    if (e instanceof Error && e.message.includes("UNIQUE")) {
      // sha256 or nonce already used — this id provably did not commit, so cleaning its R2 object now is safe.
      try { await env.RELICS.delete(key); } catch { /* best-effort */ }
      return Response.json({ error: "already offered" }, { status: 409 });
    }
    // Ambiguous failure: the insert may have committed with the response lost. Do NOT delete — if it committed,
    // EYE perceives it normally; if it truly didn't, the 24h quarantine sweep reclaims the orphan.
    throw e;
  }

  // How many marks were OFFERED today, this one included -- not /api/tallies's `marks`, which
  // counts only what the Eye has WITNESSED (perceived_at set, set later by the Daily Rite, not at
  // offer time). Offertory-stage count is the one true thing to show at the confirmation moment.
  const dayStart = Date.parse(new Date(now).toISOString().slice(0, 10) + "T00:00:00.000Z");
  const offeredToday = (await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM offerings WHERE created_at >= ?1 AND created_at < ?2`
  ).bind(dayStart, dayStart + 86_400_000).first<{ n: number }>())?.n ?? 1;

  return Response.json({ id, status: "pending", offeredToday }, { status: 201 });
}
