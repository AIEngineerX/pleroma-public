import { ulid } from "ulid";
import type { Env } from "./env";
import { nonceIsFresh } from "./nonce";
import { verifyOffering } from "./signature";
import { commitOffering, offeringBySha } from "./db";

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

  return Response.json({ id, status: "pending" }, { status: 201 });
}
