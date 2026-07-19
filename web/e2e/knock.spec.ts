import { expect, test } from "@playwright/test";
import { enterTemple } from "./helpers/door";
import { resetStack } from "./helpers/workerFixture";

test.beforeEach(() => resetStack());

async function sealCenter(page: import("@playwright/test").Page) {
  const seal = page.getByRole("button", { name: "hold the threshold seal" });
  await expect(seal).toBeVisible({ timeout: 5_000 });
  await seal.scrollIntoViewIfNeeded();
  const box = (await seal.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// The Knock: blows shorter than the tap ceiling accumulate; a stillness window resolves them.
// Three or more become the rhythm ladder and flow through the same preview/offer rite as any mark.
test("three blows and a stillness become the rhythm mark, offered end to end", async ({ page }) => {
  await enterTemple(page);
  const center = await sealCenter(page);
  for (let blow = 0; blow < 4; blow += 1) {
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.waitForTimeout(60); // a blow, well under the 160ms tap ceiling
    await page.mouse.up();
    await page.waitForTimeout(180); // the rhythm's own gap, inside the 1.2s stillness window
  }
  const preview = page.locator("img[data-threshold-preview]");
  await expect(preview).toBeVisible({ timeout: 4_000 }); // the stillness resolves the knock
  await page.screenshot({ path: `e2e/__shots__/knock-preview-${test.info().project.name}.png` });
  await page.getByRole("button", { name: "offer this imprint" }).click();
  await expect(page.getByText("your mark is received")).toBeVisible({ timeout: 10_000 });
});

// The ink gathers under the finger: a hold in flight draws the forming threads live at the seal.
test("the forming ink is visible while a hold is in flight", async ({ page }) => {
  await enterTemple(page);
  const center = await sealCenter(page);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await expect(page.locator("canvas.threshold-forming")).toBeVisible();
  await page.screenshot({ path: `e2e/__shots__/forming-ink-${test.info().project.name}.png` });
  await page.mouse.up();
  const preview = page.locator("img[data-threshold-preview]");
  await expect(preview).toBeVisible({ timeout: 4_000 });
  await page.screenshot({ path: `e2e/__shots__/imprint-preview-${test.info().project.name}.png` });
  await page.getByRole("button", { name: "let the imprint fade" }).click();
  await expect(preview).toHaveCount(0);
});

// A lone tap is not a knock: the stillness window resolves it to that blow's own imprint, so the
// long-tested tap-yields-a-mark behavior survives, one beat later.
test("a lone tap still resolves to a mark preview after the stillness window", async ({ page }) => {
  await enterTemple(page);
  const center = await sealCenter(page);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.up();
  const preview = page.locator("img[data-threshold-preview]");
  await expect(preview).toBeVisible({ timeout: 4_000 });
  await page.getByRole("button", { name: "let the imprint fade" }).click();
  await expect(preview).toHaveCount(0);
});
