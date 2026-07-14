import { expect, test } from "@playwright/test";
import { resetStack } from "./helpers/workerFixture";

test("the Reliquary and margin tallies render (attendance roll, machine margins)", async ({ page }) => {
  resetStack();
  await page.goto("/");
  const reliquary = page.getByRole("region", { name: "the Reliquary" });
  const tallies = page.getByRole("complementary", { name: "attendance" });
  await expect(reliquary).toBeVisible();
  await expect(tallies).toBeVisible();
  await tallies.screenshot({ path: `e2e/__shots__/reliquary-tallies-${test.info().project.name}.png` });
  await reliquary.screenshot({ path: `e2e/__shots__/reliquary-${test.info().project.name}.png` });
});
