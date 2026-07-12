import { expect, test } from "@playwright/test";
// [day-6 rehearsal] Requires the local Worker running with a seeded active rite. Asserts the 2s cadence.
test("polls every 2s during an active rite", async ({ page }) => {
  const hits: number[] = [];
  await page.route("**/api/state", (r) => { hits.push(Date.now()); return r.continue(); });
  await page.goto("/");
  await page.waitForTimeout(7000);
  const gaps = hits.slice(1).map((t, i) => t - hits[i]);
  expect(Math.min(...gaps)).toBeLessThan(3000);
});
