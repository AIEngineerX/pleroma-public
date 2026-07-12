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

describe("reconcileHolders (lock-guarded pulse_state write)", () => {
  it("updates holders under the pulse lock without throwing when no mint is configured", async () => {
    const { reconcileHolders: reconcile } = await import("../src/holders");
    const result = await reconcile({ ...env, PULSE_MINT: "" });
    expect(result.holders).toBe(0);
    const row = await env.DB.prepare(`SELECT value FROM config WHERE key = 'pulse_state'`).first<{ value: string }>();
    expect(row).not.toBeNull();
    expect(JSON.parse(row!.value).holders).toBe(0);
  });
});
