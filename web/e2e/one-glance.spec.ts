import { expect, test } from "@playwright/test";

test("temple reads as a living manuscript at a glance", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "PLEROMA" })).toBeVisible();
  await expect(page.locator(".rail-l")).toBeVisible();          // machine margins
  await expect(page.locator(".rail-r")).toBeVisible();
  // warm parchment ground, not a dark shrine
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).not.toBe("rgb(0, 0, 0)");
  await page.screenshot({ path: `e2e/__shots__/one-glance-${test.info().project.name}.png`, fullPage: false });
});
