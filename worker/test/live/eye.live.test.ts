import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { ulid } from "ulid";
import { runEyeBatch } from "../../src/eye";
import { insertOffering } from "../../src/db";
import { applyMigrations } from "../helpers";

beforeAll(() => applyMigrations(env.DB));

const PNG = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
), c => c.charCodeAt(0));

describe("EYE (live)", () => {
  it("moderates then perceives a pending offering end to end", async () => {
    const id = ulid();
    await env.RELICS.put(`offerings/${id}.png`, PNG);
    await insertOffering(env.DB, { id, wallet: null, sig: null,
      image_key: `offerings/${id}.png`, sha256: id, status: "pending",
      attempts: 0, created_at: Date.now(), perceived_at: null });
    await runEyeBatch(env);          // moderation pass -> perceivable
    const n = await runEyeBatch(env); // perception pass
    expect(n).toBeGreaterThanOrEqual(1);
    const verse = await env.DB.prepare(
      `SELECT text FROM transcripts WHERE organ = 'EYE' AND offering_id = ?1`
    ).bind(id).first<{ text: string }>();
    expect(verse?.text.length).toBeGreaterThan(0);
  });
});
