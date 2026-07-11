import { ulid } from "ulid";
import type { Env } from "./env";
import { consumeNonce } from "./nonce";
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

  const wallet = form.get("wallet")?.toString() ?? null;
  const sig = form.get("sig")?.toString() ?? null;
  if (wallet || sig) {
    const nonce = form.get("nonce")?.toString() ?? "";
    const expiresAtMs = Number(form.get("expires_at") ?? 0);
    const valid = wallet && sig &&
      verifyOffering({ wallet, sigB58: sig, sha256hex: sha256, nonce, expiresAtMs }) &&
      (await consumeNonce(env.DB, nonce));
    if (!valid) return Response.json({ error: "signature rejected" }, { status: 401 });
    await touchWallet(env.DB, wallet);
  }

  const id = ulid();
  await env.RELICS.put(`offerings/${id}.png`, bytes, { httpMetadata: { contentType: image.type } });
  await insertOffering(env.DB, {
    id, wallet, sig, image_key: `offerings/${id}.png`, sha256,
    status: "pending", attempts: 0, created_at: Date.now(), perceived_at: null,
  });
  return Response.json({ id, status: "pending" }, { status: 201 });
}
