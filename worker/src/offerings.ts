import { ulid } from "ulid";
import type { Env } from "./env";
import { consumeNonce, peekNonceValid } from "./nonce";
import { verifyOffering } from "./signature";
import { addTranscript, insertOffering, offeringBySha, touchWallet } from "./db";

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
    // Verify only — no state change: signature validity, and that the nonce currently looks
    // like a real, unused, unexpired server-issued token. The nonce is not consumed here;
    // consumption (and the wallet touch) happen AFTER the offering row is durably inserted
    // below, so a later failure can never burn a legitimate nonce or inflate offering_count
    // non-retryably.
    const valid = wallet && sig &&
      verifyOffering({ wallet, sigB58: sig, sha256hex: sha256, nonce, expiresAtMs }) &&
      (await peekNonceValid(env.DB, nonce));
    if (!valid) return Response.json({ error: "signature rejected" }, { status: 401 });
  }

  const id = ulid();
  // Uploads are quarantined until a moderation ALLOW promotes them to offerings/ (see
  // eye.ts). Rejects purge the quarantine object and are never kept in permanent R2.
  const key = `quarantine/${id}`;
  await env.RELICS.put(key, bytes, { httpMetadata: { contentType: image.type } });
  try {
    await insertOffering(env.DB, {
      id, wallet, sig, image_key: key, sha256,
      status: "pending", attempts: 0, created_at: Date.now(), perceived_at: null,
    });
  } catch (e) {
    // Any insert failure — a lost duplicate-sha race with a concurrent submission, or
    // anything else — must not orphan the R2 object we just wrote.
    try { await env.RELICS.delete(key); } catch { /* best-effort; do not mask the original error */ }
    if (e instanceof Error && e.message.includes("UNIQUE")) {
      return Response.json({ error: "already offered" }, { status: 409 });
    }
    throw e;
  }

  // The offering row is now durably inserted — the acceptance is real regardless of what
  // happens next. Only now do we consume the nonce and bump the wallet's offering count.
  if (wallet) {
    const consumed = await consumeNonce(env.DB, nonce);
    if (!consumed) {
      // Rare: the nonce was already spent, or expired, between the peek above and here.
      // The offering exists regardless — acceptable per PLANNING.md; log it rather than
      // fail an otherwise-successful response.
      await addTranscript(env.DB, { id: ulid(), organ: "PRIEST", register: "system",
        text: `offering ${id} accepted but nonce consumption failed post-insert`,
        offering_id: id, rite_id: null, created_at: Date.now() });
    }
    await touchWallet(env.DB, wallet);
  }
  return Response.json({ id, status: "pending" }, { status: 201 });
}
