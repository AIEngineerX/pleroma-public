import { expect, test } from "@playwright/test";
import { executeD1, resetStack } from "./helpers/workerFixture";

test.beforeEach(() => {
  resetStack();
  executeD1("UPDATE config SET value = '1' WHERE key = 'launched';");
});

test("draws a mark, wicks it into the Stain, and offers it anonymously", async ({ page }) => {
  await page.goto("/");
  const canvas = page.locator('canvas[width="512"]');
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;

  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.7, { steps: 8 });
  await page.mouse.up();

  const offer = page.getByRole("button", { name: "Offer a mark" });
  await expect(offer).toBeVisible();
  await offer.click();

  await expect(page.getByRole("status")).toHaveText("offered", { timeout: 10_000 });
});

test("refuses a blank canvas", async ({ page }) => {
  await page.goto("/");
  const offer = page.getByRole("button", { name: "Offer a mark" });
  await offer.click();
  await expect(page.getByRole("status")).toHaveText("draw a mark first");
});
