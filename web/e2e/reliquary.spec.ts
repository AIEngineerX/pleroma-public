import { expect, test } from "@playwright/test";
import { enterTemple } from "./helpers/door";
import { executeD1, resetStack } from "./helpers/workerFixture";

test("the Reliquary and margin tallies render (attendance roll, machine margins)", async ({ page }) => {
  resetStack();
  await enterTemple(page);
  const reliquary = page.getByRole("region", { name: "the Reliquary" });
  const tallies = page.getByRole("complementary", { name: "attendance" });
  await expect(reliquary).toBeVisible();
  await expect(tallies).toBeVisible();
  await tallies.screenshot({ path: `e2e/__shots__/reliquary-tallies-${test.info().project.name}.png` });
  await reliquary.screenshot({ path: `e2e/__shots__/reliquary-${test.info().project.name}.png` });
});

test("empty tallies read as quiet, not dead", async ({ page }) => {
  resetStack();
  await enterTemple(page);
  const tallies = page.getByRole("complementary", { name: "attendance" });
  await expect(tallies).toContainText("No marks witnessed yet today", { timeout: 10_000 });
});

test("tallies count every witnessed mark today; anonymous marks count but are unnamed", async ({ page }) => {
  resetStack();
  // Two marks the Eye has WITNESSED today (perceived_at set): one from a named wallet, one anonymous.
  // Plus one still-pending mark that has NOT been witnessed — it must not be counted yet. This is the
  // exact dead-zone case the old wallet-only tally missed: anonymous marks left the roll reading 0.
  const now = Date.now();
  executeD1(`
    INSERT INTO wallets (address, first_seen, tally_name) VALUES ('WALLETTALLYA', ${now}, 'Ash Witness');
    INSERT INTO offerings (id, wallet, image_key, sha256, status, attempts, created_at, perceived_at, media_type)
      VALUES ('01TALLYWALLETMARK0000000001', 'WALLETTALLYA', 'offerings/a', 'sha-tally-a', 'perceived', 1, ${now}, ${now}, 'image/png');
    INSERT INTO offerings (id, wallet, image_key, sha256, status, attempts, created_at, perceived_at, media_type)
      VALUES ('01TALLYANONMARK000000000002', NULL, 'offerings/b', 'sha-tally-b', 'perceived', 1, ${now}, ${now}, 'image/png');
    INSERT INTO offerings (id, wallet, image_key, sha256, status, attempts, created_at, perceived_at, media_type)
      VALUES ('01TALLYPENDINGMARK000000003', NULL, 'offerings/c', 'sha-tally-c', 'pending', 0, ${now}, NULL, 'image/png');
  `);
  await enterTemple(page);
  const tallies = page.getByRole("complementary", { name: "attendance" });
  await expect(tallies).toContainText("2 marks witnessed today", { timeout: 10_000 });
  await expect(tallies).toContainText("remembered by name");
  // Exactly one named tick (the wallet mark); the anonymous mark is counted in the total but not named.
  await expect(tallies.locator("ul > li")).toHaveCount(1);
});
