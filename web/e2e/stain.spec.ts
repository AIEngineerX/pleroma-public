import { expect, test } from "@playwright/test";
test("the Stain renders ink on parchment (one-glance)", async ({ page }) => {
  await page.goto("/");
  // Scoped to the Stain's own region: OfferingCanvas (Task 8) mounts a second <canvas>, so an
  // unscoped page-wide locator now matches 2 elements and trips Playwright's strict mode.
  const canvas = page.getByRole("region", { name: "the page" }).locator("canvas");
  // desktop/mobile tiers create a canvas; reduced-motion (not set here) would not.
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(1200);                            // let the sim advect a few frames
  await page.screenshot({ path: `e2e/__shots__/stain-${test.info().project.name}.png` });
});
