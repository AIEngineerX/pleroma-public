import { expect, test } from "@playwright/test";
import { resetStack } from "./helpers/workerFixture";

test.beforeEach(() => resetStack());

test("temple reads as a living manuscript at a glance", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toHaveText("PLEROMA");
  await expect(page.locator("h1")).toHaveClass(/sr-only/);
  await expect(page.getByRole("button", { name: "Offer it a mark" })).toBeVisible();
  await expect(page.locator("canvas[data-organ-swarm]")).toBeVisible();
  await expect(page.locator(".rail-l")).toBeVisible();
  await expect(page.locator(".rail-r")).toBeVisible();
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(background).not.toBe("rgb(0, 0, 0)");
  const firstFrame = await page.screenshot({ fullPage: false });
  const luminance = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const sample = document.createElement("canvas");
    sample.width = 16;
    sample.height = 16;
    const context = sample.getContext("2d")!;
    context.drawImage(image, 0, 0, sample.width, sample.height);
    const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
    let total = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      total += (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3;
    }
    return total / (pixels.length / 4);
  }, firstFrame.toString("base64"));
  expect(luminance).toBeGreaterThan(80);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `e2e/__shots__/one-glance-${test.info().project.name}.png`, fullPage: false });
});
