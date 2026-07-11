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

async function submit(bytes: Uint8Array, signed: boolean) {
  const form = new FormData();
  form.set("image", new Blob([bytes], { type: "image/png" }), "o.png");
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
});
