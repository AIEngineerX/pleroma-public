import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { raiseAlert, clearAlert, activeAlerts } from "../src/alert";
import { applyMigrations } from "./helpers";

beforeAll(() => applyMigrations(env.DB));

describe("operator alerting", () => {
  it("raises a config-only alert and never leaks the detail to the public codex", async () => {
    const detail = "rite 2026-07-12 phase sermon failed: internal-only diagnostic string";
    await raiseAlert(env, "rite_failed", detail);
    // the aggregate signal is set (this is what drives /api/state's public `degraded:true`)
    expect(await activeAlerts(env.DB)).toContain("rite_failed");
    // the DETAIL must NOT reach any transcript: /api/codex serves transcripts publicly and unauthenticated,
    // so a transcript carrying the detail would leak internal state permanently (the bug this fix closes).
    const leaked = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM transcripts WHERE text LIKE '%internal-only diagnostic%'`
    ).first<{ n: number }>();
    expect(leaked?.n).toBe(0);
    // clearing removes the flag entirely, with no orphaned public trace left to outlive it
    await clearAlert(env, "rite_failed");
    expect(await activeAlerts(env.DB)).not.toContain("rite_failed");
  });
});
