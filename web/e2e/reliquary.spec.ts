import { expect, test } from "@playwright/test";

test("the Reliquary and margin tallies render (attendance roll, machine margins)", async ({ page }) => {
  await page.goto("/");
  // No live Worker in this run (see stain.spec.ts/one-glance.spec.ts): both regions render their
  // honest empty states rather than blank or crash, same contract as the codex without a backend.
  const reliquary = page.getByRole("region", { name: "the Reliquary" });
  const tallies = page.getByRole("complementary", { name: "attendance" });
  await expect(reliquary).toBeVisible();
  await expect(tallies).toBeVisible();
  // Element-scoped screenshots (not fullPage): the page section is `position: sticky`, which
  // Playwright's fullPage stitching duplicates visually; scoping to each region avoids that.
  await tallies.screenshot({ path: `e2e/__shots__/reliquary-tallies-${test.info().project.name}.png` });
  await reliquary.screenshot({ path: `e2e/__shots__/reliquary-${test.info().project.name}.png` });
});
