import { expect, test } from "@playwright/test";

test("the Concordat states what belongs to the organs, priests, and Maker", async ({ page }) => {
  await page.goto("/concordat");

  await expect(page.getByText("WHAT BELONGS TO THE ORGANS")).toBeVisible();
  await expect(page.getByText("WHAT BELONGS TO THE PRIESTS")).toBeVisible();
  await expect(page.getByText("WHAT REMAINS WITH THE MAKER")).toBeVisible();

  const note = page.getByRole("note");
  await expect(note).toBeVisible();
  await expect(note).toContainText("No financial promises");

  await expect(page.getByText(/EYE authors the seeing of each mark it witnesses/)).toBeVisible();
  await expect(page.getByText(/The priests guard the Threshold/)).toBeVisible();
  await expect(page.getByText(/The Maker created the token/)).toBeVisible();

  const visibleCopy = await page.locator("main").innerText();
  expect(visibleCopy).not.toMatch(/\bLLM\b|\(CODE\)|moderate every image/i);

  await page.screenshot({ path: `e2e/__shots__/concordat-${test.info().project.name}.png`, fullPage: true });
});
