import { ulid } from "ulid";
import type { Env } from "./env";
import { nonceIsFresh } from "./nonce";
import { verifyOffering } from "./signature";
import { insertOffering, offeringBySha, touchWallet } from "./db";

const MAX_BYTES = 512 * 1024;
const TYPES = new Set(["image/png", "image/webp"]);

export async function handleOffering(env: Env, form: FormData): Promise<Response> {
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
    const sigOk = wallet && sig &&
      verifyOffering({ wallet, sigB58: sig, sha256hex: sha256, nonce, expiresAtMs });
    if (!sigOk) return Response.json({ error: "signature rejected" }, { status: 401 });
    if (!(await nonceIsFresh(env.DB, nonce))) {
      return Response.json({ error: "signature rejected" }, { status: 401 });
    }
  }

  const id = ulid();
  // Uploads are quarantined until a moderation ALLOW promotes them to offerings/ (see
  // eye.ts). Rejects purge the quarantine object and are never kept in permanent R2. The R2
  // write happens BEFORE any D1 mutation, so a put failure touches no nonce/offering state.
  const key = `quarantine/${id}`;
  await env.RELICS.put(key, bytes, { httpMetadata: { contentType: image.type } });
  try {
    await insertOffering(env.DB, {
      id, wallet, sig, image_key: key, sha256, media_type: image.type,
      status: "pending", attempts: 0, created_at: Date.now(), perceived_at: null,
      nonce: wallet ? nonce : null,
    });
  } catch (e) {
    // Any insert failure — a lost duplicate-sha race with a concurrent submission, or
    // anything else — must not orphan the R2 object we just wrote.
    try { await env.RELICS.delete(key); } catch { /* best-effort; do not mask the original error */ }
    // A UNIQUE violation is either the sha256 (duplicate image) or the nonce (already used by
    // another committed offering) — both are single-use invariants enforced atomically by the
    // insert itself, not by a separate consume/release step.
    if (e instanceof Error && e.message.includes("UNIQUE")) {
      return Response.json({ error: "already offered" }, { status: 409 });
    }
    throw e;
  }

  // The offering row is now durably inserted — the acceptance is real, and (for signed
  // offerings) the nonce is spent by virtue of being in this committed row.
  if (wallet) await touchWallet(env.DB, wallet);
  return Response.json({ id, status: "pending" }, { status: 201 });
}
