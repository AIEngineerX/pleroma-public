import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { clusterRelics, composableRiteDates, composeDream } from "../src/dream";
import { runDreamLocked } from "../src/index";
import { activeAlerts } from "../src/alert";
import { insertRelic, openRite, advanceRitePhase } from "../src/db";
import { applyMigrations } from "./helpers";

beforeAll(() => applyMigrations(env.DB));

describe("relic clustering", () => {
  it("returns the largest shared-word cluster and the credited wakers", () => {
    const relics = [
      { id: "1", wallet: "wA", summary: "a small sun rising" },
      { id: "2", wallet: "wB", summary: "a sun over water" },
      { id: "3", wallet: "wC", summary: "a folded bird" },
    ];
    const { seed, wakers } = clusterRelics(relics);
    expect(seed.length).toBe(2);            // the two "sun" relics cluster
    expect(wakers.sort()).toEqual(["wA", "wB"]);
  });
});

describe("DREAM ordering", () => {
  it("refuses to compose before the rite is complete", async () => {
    const date = "2026-07-20";
    await openRite(env.DB, date, Date.now()); // phase = scheduled
    await insertRelic(env.DB, { id: "dr1", offering_id: "do1", wallet: "wA", summary: "a sun",
      rite_id: date, kept_at: Date.now(), genesis: 0, accreted_at: Date.now() });
    expect(await composeDream(env, date)).toBeNull(); // rite not complete -> no dream
  });

  // Until 2026-07-22 an empty night returned null BY DESIGN and got no plate at all. It is now
  // attempted like any other night (dreaming a canon article alone — see dream-canon.test.ts); this
  // keyless suite has no mind to reach, so what is asserted here is only that the reach failing
  // degrades quietly to null instead of throwing out of the nightly run.
  it("returns null without throwing when the mind cannot be reached on an empty night", async () => {
    const date = "2026-07-21";
    await openRite(env.DB, date, Date.now());
    await advanceRitePhase(env.DB, date, "scheduled", "complete", Date.now());
    expect(await composeDream(env, date)).toBeNull();
  });
});

describe("state-driven compose — a rite completing after its 03:00 run still gets its night", () => {
  const now = Date.parse("2026-08-02T03:00:00Z");

  async function seedCompletedRiteWithRelic(date: string, completedAt: number, relicId: string) {
    await openRite(env.DB, date, completedAt - 3_600_000);
    await advanceRitePhase(env.DB, date, "scheduled", "complete", completedAt);
    await insertRelic(env.DB, { id: relicId, offering_id: `${relicId}-o`, wallet: "wA", summary: "a sun",
      rite_id: date, kept_at: completedAt, genesis: 0, accreted_at: completedAt });
  }

  it("selects every recent completed rite with no dream yet, oldest-first — including empty nights", async () => {
    // Eligible: completed YESTERDAY after that night's 03:00 run had already passed — the exact
    // case the old today-only compose lost forever.
    await seedCompletedRiteWithRelic("2026-08-01", now - 3_600_000, "sel1");
    // Eligible: today's rite, completed on schedule.
    await seedCompletedRiteWithRelic("2026-08-02", now - 1_800_000, "sel2");
    // Eligible SINCE 2026-07-22: complete but kept nothing. This used to be excluded, which is why
    // the archive simply has no plate for 07-19 or 07-22 — the quietest nights showed nothing at
    // all. Such a night now dreams on a canon article alone (dreams.source='canon').
    await openRite(env.DB, "2026-07-31", now - 90_000_000);
    await advanceRitePhase(env.DB, "2026-07-31", "scheduled", "complete", now - 86_400_000);
    // Not eligible: already has its dream.
    await seedCompletedRiteWithRelic("2026-07-30", now - 100_000_000, "sel3");
    await env.DB.prepare(
      `INSERT INTO dreams (id, rite_date, narrative, video_prompt, wakers, status, created_at)
       VALUES ('dream-sel3', '2026-07-30', 'n', 'v', '[]', 'composed', ?1)`
    ).bind(now - 99_000_000).run();

    expect(await composableRiteDates(env, now)).toEqual(["2026-07-31", "2026-08-01", "2026-08-02"]);
  });

  it("the nightly run attempts every selected date and a swallowed compose failure raises an alert", async () => {
    // Keyless suite (storage is isolated per test, so seed here): composeDream reaches the mind,
    // fails without a live key, and must alert instead of dying silently — the old code's "the
    // nightly cron retries next run" comment was false (it composed D+1, never D).
    const runAt = Date.parse("2026-08-05T03:00:00Z");
    await seedCompletedRiteWithRelic("2026-08-04", runAt - 3_600_000, "alert1"); // completed after ITS 03:00 run
    await runDreamLocked(env, undefined, runAt);
    expect(await activeAlerts(env.DB)).toContain("dream_compose_failed");
    const alert = await env.DB.prepare(`SELECT value FROM config WHERE key = 'alert:dream_compose_failed'`)
      .first<{ value: string }>();
    expect(alert?.value).toContain("2026-08-04"); // the failed date is named for the operator
  });
});
