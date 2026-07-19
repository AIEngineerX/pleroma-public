import { expect, test } from "@playwright/test";

test("the Concordat states what belongs to the organs, priests, and Maker", async ({ page }) => {
  await page.goto("/concordat");

  await expect(page.getByText("WHAT BELONGS TO THE ORGANS")).toBeVisible();
  await expect(page.getByText("WHAT BELONGS TO THE PRIESTS")).toBeVisible();
  await expect(page.getByText("WHAT REMAINS WITH THE MAKER")).toBeVisible();

  await expect(page.getByText(/EYE authors the seeing of each mark it witnesses/)).toBeVisible();
  await expect(page.getByText(/The priests guard the Threshold/)).toBeVisible();
  // Launch-neutral: the Concordat claims the authority to create the token, never that a token
  // already exists while the dormant site truthfully says there is no mint.
  await expect(page.getByText(/The token is the Maker's alone to create/)).toBeVisible();
  // The Attended prior is a code-authored weighting of KEEP's verdict; the Concordat must name it.
  await expect(page.getByText(/stated prior toward keeping/)).toBeVisible();

  const visibleCopy = await page.locator("main").innerText();
  expect(visibleCopy).not.toMatch(/\bLLM\b|\(CODE\)|moderate every image/i);

  await page.screenshot({ path: `e2e/__shots__/concordat-${test.info().project.name}.png`, fullPage: true });
});
