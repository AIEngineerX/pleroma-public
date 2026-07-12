import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { clusterRelics, composeDream } from "../src/dream";
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

  it("composes nothing (no throw) when there are no relics even if the rite is complete", async () => {
    const date = "2026-07-21";
    await openRite(env.DB, date, Date.now());
    await advanceRitePhase(env.DB, date, "scheduled", "complete", Date.now());
    expect(await composeDream(env, date)).toBeNull();
  });
});
