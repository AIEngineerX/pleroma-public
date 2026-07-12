import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { runKeep } from "../../src/keep";
import { insertOffering } from "../../src/db";
import { applyMigrations } from "../helpers";

beforeAll(() => applyMigrations(env.DB));

describe("KEEP (live)", () => {
  it("renders a real verdict and transitions the offering", async () => {
    const id = "keep-live";
    await insertOffering(env.DB, { id, wallet: null, sig: null, image_key: `offerings/${id}`,
      sha256: id, status: "perceived", attempts: 0, created_at: Date.now(), perceived_at: Date.now() });
    await env.DB.prepare(`INSERT INTO transcripts (id, organ, register, text, offering_id, rite_id, created_at)
      VALUES ('kl-verse','EYE','verse','a small bright coil, drawn in a hurried hand', ?1, NULL, ?2)`)
      .bind(id, Date.now()).run();
    await runKeep(env, "2026-07-12-live");
    const row = await env.DB.prepare(`SELECT status FROM offerings WHERE id = ?1`).bind(id).first<{ status: string }>();
    expect(["kept", "mourned"]).toContain(row?.status);
  });

  it("honors a past deadline: renders no verdict and leaves the offering perceived (bounds the rite lock-hold)", async () => {
    // The discriminating half of the deadline fix: with a REAL key the offering above IS processed to a
    // verdict, so a `perceived` outcome here can only mean the loop broke on the deadline before the LLM
    // call — proving deadlineMs actually gates work, not merely that a keyless run happens to render nothing.
    const id = "keep-live-deadline";
    await insertOffering(env.DB, { id, wallet: null, sig: null, image_key: `offerings/${id}`,
      sha256: id, status: "perceived", attempts: 0, created_at: Date.now(), perceived_at: Date.now() });
    await env.DB.prepare(`INSERT INTO transcripts (id, organ, register, text, offering_id, rite_id, created_at)
      VALUES ('kl-dl-verse','EYE','verse','a small bright coil, drawn in a hurried hand', ?1, NULL, ?2)`)
      .bind(id, Date.now()).run();
    const kept = await runKeep(env, "2026-07-12-live", Date.now() - 1_000); // deadline already in the past
    expect(kept).toBe(0);
    const row = await env.DB.prepare(`SELECT status FROM offerings WHERE id = ?1`).bind(id).first<{ status: string }>();
    expect(row?.status).toBe("perceived"); // untouched: the loop broke before ever reaching askMind
  });
});
