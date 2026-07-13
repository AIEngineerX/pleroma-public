import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { countHolders, parseHolderPage, reconcileHolders } from "../src/holders";
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

describe("parseHolderPage (degraded-response handling)", () => {
  it("throws on a JSON-RPC error returned with HTTP 200 (must not collapse to zero holders)", () => {
    // Helius can return a 200 whose body is an error, not a result. The old code read result?.token_accounts
    // ?? [] and saw 'zero holders', zeroing the count and clearing every attended flag. This must throw so
    // the caller keeps last-good and raises the stale alert.
    expect(() => parseHolderPage({ error: { code: -32000, message: "temporarily unavailable" } })).toThrow();
    expect(() => parseHolderPage({})).toThrow(); // missing result entirely
  });

  it("treats a present result with an empty account list as a legitimate true-zero page", () => {
    // A VALID response that genuinely has no holders must still be honored as zero (not an outage).
    expect(parseHolderPage({ result: { token_accounts: [] } })).toEqual([]);
    const accts = parseHolderPage({ result: { token_accounts: [{ owner: "A", amount: 5 }] } });
    expect(accts).toEqual([{ owner: "A", amount: 5 }]);
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
