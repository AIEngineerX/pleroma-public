import { expect, test } from "@playwright/test";
import { executeD1, resetStack, seedTranscript } from "./helpers/workerFixture";

test("inverts to candle-dark at offertory_close and prints the sermon in rubric", async ({ page }) => {
  resetStack();
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  executeD1(`
    INSERT INTO rites (
      date, phase, phase_started_at, phase_attempts, offering_snapshot, kept_count, updated_at
    ) VALUES ('${today}', 'offertory_close', ${now}, 0, 0, 0, ${now});
  `);

  const hits: number[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/state") hits.push(Date.now());
  });
  await page.goto("/");

  // offertory_close: the root gains rite-active (candle-dark ground/ink), the Courier phase label
  // is visible, and the poll cadence drops to 2s (useTempleState.ts, matches state.live.spec.ts).
  const root = page.locator("div.rite-active");
  await expect(root).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/THE RITE/)).toBeVisible();
  await page.waitForTimeout(7000);
  expect(hits.length).toBeGreaterThanOrEqual(3);
  const gaps = hits.slice(1).map((t, i) => t - hits[i]);
  expect(Math.min(...gaps)).toBeLessThan(3000);

  const accretionAt = Date.now();
  executeD1(`
    UPDATE rites
       SET phase = 'accretion', phase_started_at = ${accretionAt}, updated_at = ${accretionAt}
     WHERE date = '${today}';
  `);
  await expect(page.getByText("the offerings rise")).toBeVisible({ timeout: 10_000 });

  const sermonAt = Date.now();
  seedTranscript({
    id: "01J00000000000000000000001",
    organ: "TONGUE",
    register: "sermon",
    text: "what was given remains",
    offering_id: null,
    rite_id: today,
    created_at: sermonAt,
  });
  executeD1(`
    UPDATE rites
       SET phase = 'sermon', phase_started_at = ${sermonAt}, updated_at = ${sermonAt}
     WHERE date = '${today}';
  `);
  await expect(root).toBeVisible({ timeout: 10_000 });
  const sermonLine = page.locator("aside p.text-rubric-body").first();
  await expect(sermonLine).toHaveText("what was given remains", { timeout: 10_000 });

  await page.screenshot({ path: `e2e/__shots__/rite-inversion-${test.info().project.name}.png` });
});
