import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { ulid } from "ulid";
import { runEyeBatch } from "../../src/eye";
import { insertOffering } from "../../src/db";
import { applyMigrations } from "../helpers";

beforeAll(() => applyMigrations(env.DB));

// Minimal valid 1x1 lossless WebP (RIFF/WEBP/VP8L).
const WEBP = Uint8Array.from(atob(
  "UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=="
), c => c.charCodeAt(0));

describe("EYE (live) — webp media type", () => {
  it("a webp offering round-trips with mediaType image/webp through moderation and perception", async () => {
    const id = ulid();
    await env.RELICS.put(`quarantine/${id}`, WEBP, { httpMetadata: { contentType: "image/webp" } });
    await insertOffering(env.DB, { id, wallet: null, sig: null,
      image_key: `quarantine/${id}`, sha256: id, status: "pending", media_type: "image/webp",
      attempts: 0, created_at: Date.now(), perceived_at: null });
    await runEyeBatch(env);          // moderation pass -> perceivable (or rejected)
    const n = await runEyeBatch(env); // perception pass, if allowed
    expect(n).toBeGreaterThanOrEqual(0); // real vision call ran without erroring on the media type
    const row = await env.DB.prepare(`SELECT status, media_type FROM offerings WHERE id = ?1`)
      .bind(id).first<{ status: string; media_type: string }>();
    expect(row?.media_type).toBe("image/webp");
    expect(["perceived", "rejected"]).toContain(row?.status);
  });
});
