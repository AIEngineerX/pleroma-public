import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { raiseAlert, clearAlert, activeAlerts } from "../src/alert";
import { applyMigrations } from "./helpers";

beforeAll(() => applyMigrations(env.DB));

describe("operator alerting", () => {
  it("raises an alert (transcript + config flag) and clears it", async () => {
    await raiseAlert(env, "rite_failed", "rite 2026-07-12 phase sermon failed");
    expect(await activeAlerts(env.DB)).toContain("rite_failed");
    const note = await env.DB.prepare(
      `SELECT text FROM transcripts WHERE organ='PRIEST' AND text LIKE '%rite_failed%' LIMIT 1`
    ).first<{ text: string }>();
    expect(note).not.toBeNull();
    await clearAlert(env, "rite_failed");
    expect(await activeAlerts(env.DB)).not.toContain("rite_failed");
  });
});
