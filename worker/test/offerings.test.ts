import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519";
import { base58 } from "@scure/base";
import { offeringMessage } from "../src/signature";
import { offeringBySha } from "../src/db";
import { applyMigrations } from "./helpers";

beforeAll(() => applyMigrations(env.DB));

const priv = ed25519.utils.randomPrivateKey();
const wallet = base58.encode(ed25519.getPublicKey(priv));

// Minimal valid 1x1 PNG.
const PNG = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
), c => c.charCodeAt(0));

async function sha256hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function submit(bytes: Uint8Array, signed: boolean, mediaType = "image/png") {
  const form = new FormData();
  form.set("image", new Blob([bytes], { type: mediaType }), "o.png");
  if (signed) {
    const nres = await SELF.fetch("http://x/api/nonce");
    const { nonce, expires_at } = await nres.json<{ nonce: string; expires_at: number }>();
    const msg = offeringMessage(await sha256hex(bytes), nonce, expires_at);
    form.set("wallet", wallet);
    form.set("sig", base58.encode(ed25519.sign(new TextEncoder().encode(msg), priv)));
    form.set("nonce", nonce);
    form.set("expires_at", String(expires_at));
  }
  return SELF.fetch("http://x/api/offerings", { method: "POST", body: form });
}

// Submits a signed offering against a CALLER-SUPPLIED nonce, so a test can reuse the same
// nonce across two requests (submit() above always mints a fresh one).
async function submitWithNonce(bytes: Uint8Array, nonce: string, expiresAt: number, mediaType = "image/png") {
  const form = new FormData();
  form.set("image", new Blob([bytes], { type: mediaType }), "o.png");
  const msg = offeringMessage(await sha256hex(bytes), nonce, expiresAt);
  form.set("wallet", wallet);
  form.set("sig", base58.encode(ed25519.sign(new TextEncoder().encode(msg), priv)));
  form.set("nonce", nonce);
  form.set("expires_at", String(expiresAt));
  return SELF.fetch("http://x/api/offerings", { method: "POST", body: form });
}

describe("offering intake", () => {
  // NOTE: merged with the "rejects a duplicate image" case. @cloudflare/vitest-pool-workers
  // isolates D1/R2 storage per `it()` block (mutations are rolled back after each test, not
  // after each file), so the duplicate check must run in the same test as the original insert
  // to see it. See task-5-report.md "Deviations" for the empirical evidence and root cause.
  it("accepts a signed offering, stores the image, and rejects a duplicate", async () => {
    const res = await submit(PNG, true);
    expect(res.status).toBe(201);
    const { id, status } = await res.json<{ id: string; status: string }>();
    expect(status).toBe("pending");
    const stored = await env.RELICS.get(`quarantine/${id}`);
    expect(stored).not.toBeNull();
    await stored?.arrayBuffer(); // consume the body: unread R2ObjectBody streams break storage teardown

    const dupe = await submit(PNG, false);
    expect(dupe.status).toBe(409);
  });

  it("accepts anonymous offerings", async () => {
    const other = new Uint8Array([...PNG, 0]); // different bytes -> different sha
    const res = await submit(other, false);
    expect(res.status).toBe(201);
  });

  it("treats empty wallet/sig fields as anonymous (wallet stored NULL)", async () => {
    const bytes = new Uint8Array([...PNG, 7]); // unique bytes -> unique sha
    const form = new FormData();
    form.set("image", new Blob([bytes], { type: "image/png" }), "o.png");
    form.set("wallet", "");
    form.set("sig", "");
    const res = await SELF.fetch("http://x/api/offerings", { method: "POST", body: form });
    expect(res.status).toBe(201);
    const row = await offeringBySha(env.DB, await sha256hex(bytes));
    expect(row).not.toBeNull();
    expect(row!.wallet).toBeNull();
  });

  it("stores the intake image under the quarantine/ prefix, not offerings/", async () => {
    const bytes = new Uint8Array([...PNG, 9, 9]); // unique bytes -> unique sha
    const res = await submit(bytes, false);
    expect(res.status).toBe(201);
    const { id } = await res.json<{ id: string }>();
    const row = await offeringBySha(env.DB, await sha256hex(bytes));
    expect(row?.image_key).toBe(`quarantine/${id}`);
    const quarantined = await env.RELICS.get(`quarantine/${id}`);
    expect(quarantined).not.toBeNull();
    await quarantined?.arrayBuffer();
    expect(await env.RELICS.get(`offerings/${id}`)).toBeNull();
  });

  it("a duplicate submission from the same wallet never increments offering_count a second time", async () => {
    const bytes = new Uint8Array([...PNG, 4, 2]); // unique bytes -> unique sha
    const first = await submit(bytes, true);
    expect(first.status).toBe(201);

    const dupe = await submit(bytes, true); // same image, fresh nonce+sig, same wallet
    expect(dupe.status).toBe(409);

    const row = await env.DB.prepare(`SELECT offering_count FROM wallets WHERE address = ?1`)
      .bind(wallet).first<{ offering_count: number }>();
    expect(row?.offering_count).toBe(1);
  });

  it("cleans up the quarantine object on ANY insert failure, not just a UNIQUE conflict", async () => {
    const bytes = new Uint8Array([...PNG, 6, 6]); // unique bytes -> unique sha
    // Force a non-UNIQUE D1 insert failure via a trigger that aborts every INSERT (the
    // offeringBySha pre-check SELECT is unaffected, so we still reach the R2 write and the
    // real insertOffering() call) — proves the R2 cleanup isn't scoped to
    // message.includes("UNIQUE"). @cloudflare/vitest-pool-workers isolates D1/R2 storage
    // per it() block, so this trigger doesn't leak into other tests.
    await env.DB.exec(
      `CREATE TRIGGER force_insert_fail BEFORE INSERT ON offerings BEGIN SELECT RAISE(ABORT, 'forced test failure'); END`
    );
    const res = await submit(bytes, false);
    expect(res.status).toBe(500);

    // The R2 object written during intake must not be orphaned in quarantine even though
    // the insert failure had nothing to do with a duplicate hash: nothing should be left
    // under quarantine/ at all from this submission.
    const objects = await env.RELICS.list({ prefix: "quarantine/" });
    expect(objects.objects).toEqual([]);
  });

  it("persists the uploaded media type, defaulting png but honoring webp", async () => {
    const pngBytes = new Uint8Array([...PNG, 8, 1]);
    const pngRes = await submit(pngBytes, false, "image/png");
    expect(pngRes.status).toBe(201);
    const pngRow = await offeringBySha(env.DB, await sha256hex(pngBytes));
    expect(pngRow?.media_type).toBe("image/png");

    const webpBytes = new Uint8Array([...PNG, 8, 2]);
    const webpRes = await submit(webpBytes, false, "image/webp");
    expect(webpRes.status).toBe(201);
    const webpRow = await offeringBySha(env.DB, await sha256hex(webpBytes));
    expect(webpRow?.media_type).toBe("image/webp");
  });

  it("rejects a bad signature with 401", async () => {
    const bytes = new Uint8Array([...PNG, 1, 2]);
    const form = new FormData();
    form.set("image", new Blob([bytes], { type: "image/png" }), "o.png");
    form.set("wallet", wallet);
    form.set("sig", base58.encode(new Uint8Array(64)));
    form.set("nonce", "c".repeat(32));
    form.set("expires_at", String(Date.now() + 60_000));
    const res = await SELF.fetch("http://x/api/offerings", { method: "POST", body: form });
    expect(res.status).toBe(401);
  });

  it("the same nonce cannot authorize two signed submissions: UNIQUE(nonce) is the atomic single-use gate", async () => {
    const nres = await SELF.fetch("http://x/api/nonce");
    const { nonce, expires_at } = await nres.json<{ nonce: string; expires_at: number }>();
    const bytesA = new Uint8Array([...PNG, 5, 1]);
    const bytesB = new Uint8Array([...PNG, 5, 2]); // different image, same nonce+wallet

    const first = await submitWithNonce(bytesA, nonce, expires_at);
    expect(first.status).toBe(201);

    // nonceIsFresh is validate-only (no consumption), so the second request passes signature +
    // freshness checks and reaches insertOffering — where the UNIQUE(nonce) partial index
    // rejects the second row with a UNIQUE constraint violation, mapped to 409.
    const second = await submitWithNonce(bytesB, nonce, expires_at);
    expect(second.status).toBe(409);

    const row = await env.DB.prepare(`SELECT offering_count FROM wallets WHERE address = ?1`)
      .bind(wallet).first<{ offering_count: number }>();
    expect(row?.offering_count).toBe(1);
  });

  it("no-burn: a sha256 duplicate rejected pre-insert never touches the nonce it was signed with, so that nonce still authorizes a genuinely new image", async () => {
    const bytesA = new Uint8Array([...PNG, 6, 3]); // unique bytes -> unique sha
    const first = await submit(bytesA, true);
    expect(first.status).toBe(201);

    // Same image bytes again (sha dup), signed with a FRESH nonce M. offeringBySha's pre-check
    // (before the wallet/sig/nonce block) rejects this with 409 before M is ever read or
    // validated — proving a failed submission cannot burn a legitimate one-time token.
    const nres = await SELF.fetch("http://x/api/nonce");
    const { nonce: M, expires_at } = await nres.json<{ nonce: string; expires_at: number }>();
    const dupe = await submitWithNonce(bytesA, M, expires_at);
    expect(dupe.status).toBe(409);

    // M was not burned by the sha-dup 409 above: it still authorizes a new, distinct image.
    const bytesB = new Uint8Array([...PNG, 6, 4]); // different image, unique sha
    const retry = await submitWithNonce(bytesB, M, expires_at);
    expect(retry.status).toBe(201);
  });
});
