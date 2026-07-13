import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { countHolders, reconcileHolders } from "../src/holders";
import { applyMigrations } from "./helpers";

beforeAll(() => applyMigrations(env.DB));

describe("holder counting", () => {
  it("counts distinct owners with a positive balance across pages", () => {
    const pages = [
      [{ owner: "A", amount: 10 }, { owner: "B", amount: 0 }],   // B has zero -> not a holder
      [{ owner: "A", amount: 5 }, { owner: "C", amount: 1 }],     // A duplicated across pages
    ];
    const { count, owners } = countHolders(pages);
    expect(count).toBe(2); // A and C
    expect(owners.has("A")).toBe(true);
    expect(owners.has("B")).toBe(false);
  });
});

describe("attended reconciliation", () => {
  it("marks held wallets attended and clears wallets that no longer hold", async () => {
    await env.DB.prepare(`INSERT INTO wallets (address, first_seen, offering_count, attended) VALUES ('holdW', 1, 1, 0)`).run();
    await env.DB.prepare(`INSERT INTO wallets (address, first_seen, offering_count, attended) VALUES ('goneW', 1, 1, 1)`).run();
    // Inject the owner set directly via the exported helper the live path also uses.
    const { applyAttended } = await import("../src/holders");
    const marked = await applyAttended(env.DB, new Set(["holdW"]));
    expect(marked).toBeGreaterThanOrEqual(1);
    const held = await env.DB.prepare(`SELECT attended FROM wallets WHERE address='holdW'`).first<{ attended: number }>();
    const gone = await env.DB.prepare(`SELECT attended FROM wallets WHERE address='goneW'`).first<{ attended: number }>();
    expect(held?.attended).toBe(1);
    expect(gone?.attended).toBe(0); // no longer a holder -> cleared
  });
});

describe("reconcileHolders (no data source -> non-destructive)", () => {
  it("keeps last-good holders and attended when the source is unavailable (never zeroes on degradation)", async () => {
    // A live-ish state on record: 5 holders, one attended wallet.
    await env.DB.prepare(`INSERT INTO config (key, value) VALUES ('pulse_state', ?1) ON CONFLICT(key) DO UPDATE SET value=?1`)
      .bind(JSON.stringify({ state: "calm", holders: 5, updated_at: 1 })).run();
    await env.DB.prepare(`INSERT INTO wallets (address, first_seen, offering_count, attended) VALUES ('keepW', 1, 1, 1)`).run();

    const { reconcileHolders: reconcile } = await import("../src/holders");
    const result = await reconcile({ ...env, PULSE_MINT: "" });   // no mint -> data source unavailable

    // The count must be kept, not zeroed, and the attended flag must survive (the bug cleared both).
    expect(result.holders).toBe(5);
    const row = await env.DB.prepare(`SELECT value FROM config WHERE key = 'pulse_state'`).first<{ value: string }>();
    expect(JSON.parse(row!.value).holders).toBe(5);
    const kept = await env.DB.prepare(`SELECT attended FROM wallets WHERE address='keepW'`).first<{ attended: number }>();
    expect(kept?.attended).toBe(1);
  });
});
