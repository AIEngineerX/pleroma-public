import { expect, test } from "@playwright/test";

// [day-6 rehearsal] Requires the local Worker running with a rite seeded/advanced through
// worker/src/db.ts openRite -> worker/src/rite.ts advanceRite (RITE_OPEN_MINUTE_OF_DAY reached,
// phase driven to offertory_close then sermon). Not run against a live Worker as part of the
// commit gate; the pure inversionClasses mapping is covered by test/riteInversion.test.ts instead.
test("inverts to candle-dark at offertory_close and prints the sermon in rubric", async ({ page }) => {
  const hits: number[] = [];
  await page.route("**/api/state", (r) => { hits.push(Date.now()); return r.continue(); });
  await page.goto("/");

  // offertory_close: the root gains rite-active (candle-dark ground/ink), the Courier phase label
  // is visible, and the poll cadence drops to 2s (useTempleState.ts, matches state.live.spec.ts).
  const root = page.locator("div.rite-active");
  await expect(root).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/THE RITE/)).toBeVisible();
  await page.waitForTimeout(7000);
  const gaps = hits.slice(1).map((t, i) => t - hits[i]);
  expect(Math.min(...gaps)).toBeLessThan(3000);

  // accretion: the offerings rise.
  await expect(page.getByText("the offerings rise")).toBeVisible({ timeout: 60_000 });

  // sermon: still candle-dark, and the god's line prints in rubric (Verse.tsx's text-rubric-body,
  // same class the codex already uses for every god-voice line -- against the inverted ground it
  // reads as the bright rubric this rite is named for).
  await expect(root).toBeVisible({ timeout: 60_000 });
  const sermonLine = page.locator("aside p.text-rubric-body").first();
  await expect(sermonLine).toBeVisible({ timeout: 60_000 });

  await page.screenshot({ path: `e2e/__shots__/rite-inversion-${test.info().project.name}.png` });
});
