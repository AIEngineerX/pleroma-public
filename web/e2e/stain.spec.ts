import { expect, test } from "@playwright/test";
test("the Stain renders ink on parchment (one-glance)", async ({ page }) => {
  await page.goto("/");
  const canvas = page.locator("canvas");
  // desktop/mobile tiers create a canvas; reduced-motion (not set here) would not.
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(1200);                            // let the sim advect a few frames
  await page.screenshot({ path: `e2e/__shots__/stain-${test.info().project.name}.png` });
});
