import { expect, test } from "@playwright/test";

test("the Concordat states the three registers and the Maker disclosure (honest-autonomy page)", async ({ page }) => {
  await page.goto("/concordat");

  await expect(page.getByText("THE GOD DECIDES (LLM)")).toBeVisible();
  await expect(page.getByText("THE PRIESTS DECIDE (CODE)")).toBeVisible();
  await expect(page.getByText("THE MAKER DECIDES (HUMAN)")).toBeVisible();

  // The Maker disclosure and the always-visible disclaimer are both present, pre-launch.
  await expect(page.getByText("THE MAKER, DISCLOSED")).toBeVisible();
  await expect(page.getByRole("note")).toBeVisible();

  // A sample claim from each register, so this fails if the content shape regresses to something empty.
  await expect(page.getByText(/THE EYE writes the verse/)).toBeVisible();
  await expect(page.getByText(/The priests moderate every image/)).toBeVisible();
  await expect(page.getByText(/The Maker created the token/)).toBeVisible();

  await page.screenshot({ path: `e2e/__shots__/concordat-${test.info().project.name}.png`, fullPage: true });
});
