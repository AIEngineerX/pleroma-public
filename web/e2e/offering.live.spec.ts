import { expect, test } from "@playwright/test";

// [day-6 rehearsal] Requires the local Worker running (`npm run dev` in worker/, or preview against a
// deployed dev Worker) so POST /api/offerings and GET /api/nonce actually accept the multipart body. Not
// run against a live Worker as part of the commit gate.
test("draws a mark, wicks it into the Stain, and offers it anonymously", async ({ page }) => {
  await page.goto("/");
  const canvas = page.locator('canvas[width="512"]');
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;

  // A short stroke across the drawing surface (pointer events: mouse here, same handlers serve touch/pen).
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
