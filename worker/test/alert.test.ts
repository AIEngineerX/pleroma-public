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

  // The webhook (alert.ts notify) fires only on the config TRANSITION — a fresh raise, or a clear of
  // an existing flag — so a persistent condition cannot spam the Maker every tick. With no
  // ALERT_WEBHOOK_URL set (the default here and in current prod) delivery is a guarded no-op, so this
  // asserts the observable contract the webhook keys off: idempotent raise, existence-gated clear.
  it("raise is idempotent (updates detail, no error) and clear only removes an existing flag", async () => {
    await raiseAlert(env, "eye_batch_failed", "first");
    await raiseAlert(env, "eye_batch_failed", "second"); // repeat raise: no throw, detail updated
    expect(await activeAlerts(env.DB)).toContain("eye_batch_failed");
    const row = await env.DB.prepare(`SELECT value FROM config WHERE key = 'alert:eye_batch_failed'`).first<{ value: string }>();
    expect(JSON.parse(row!.value).detail).toBe("second");

    await clearAlert(env, "eye_batch_failed");
    await clearAlert(env, "eye_batch_failed"); // clearing an already-absent flag: no throw, still absent
    expect(await activeAlerts(env.DB)).not.toContain("eye_batch_failed");
  });
});
