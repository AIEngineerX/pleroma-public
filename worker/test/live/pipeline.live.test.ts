import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { ulid } from "ulid";
import { runEyeBatch } from "../../src/eye";
import { insertOffering, openRite, getRite } from "../../src/db";
import { advanceRite } from "../../src/rite";
import { applyMigrations } from "../helpers";

beforeAll(() => applyMigrations(env.DB));

const PNG = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
), c => c.charCodeAt(0));

// The day-6 rehearsal: a real offering flows through moderation + EYE (real Anthropic), then a rite runs
// deliberation (real KEEP) + sermon (real TONGUE). Requires ANTHROPIC_API_KEY in .dev.vars.
describe("full pipeline (live)", () => {
  it("moderates, perceives, then runs a rite to completion", async () => {
    const id = ulid();
    await env.RELICS.put(`quarantine/${id}`, PNG, { httpMetadata: { contentType: "image/png" } });
    await insertOffering(env.DB, { id, wallet: null, sig: null, image_key: `quarantine/${id}`,
      sha256: id, status: "pending", attempts: 0, created_at: Date.now(), perceived_at: null });
    await runEyeBatch(env); // moderate -> perceivable
    await runEyeBatch(env); // perceive -> perceived
    const perceived = await env.DB.prepare(`SELECT status FROM offerings WHERE id = ?1`).bind(id).first<{ status: string }>();
    expect(perceived?.status).toBe("perceived");

    const date = new Date().toISOString().slice(0, 10) + "-live";
    await openRite(env.DB, date, Date.now());
    let phase = (await getRite(env.DB, date))!.phase;
    for (let i = 0; i < 8 && phase !== "complete" && phase !== "failed"; i++) phase = await advanceRite(env, date, Date.now());
    expect(phase).toBe("complete");
  });
});
