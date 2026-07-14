import { expect, test } from "@playwright/test";
import { executeD1, resetStack } from "./helpers/workerFixture";

test.beforeEach(() => {
  resetStack();
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  executeD1(`
    INSERT INTO rites (
      date, phase, phase_started_at, phase_attempts, offering_snapshot, kept_count, updated_at
    ) VALUES ('${today}', 'scheduled', ${now}, 0, 0, 0, ${now});
  `);
});

test("polls every 2s during an active rite", async ({ page }) => {
  const hits: number[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/state") hits.push(Date.now());
  });
  await page.goto("/");
  await page.waitForTimeout(7000);
  expect(hits.length).toBeGreaterThanOrEqual(3);
  const gaps = hits.slice(1).map((t, i) => t - hits[i]);
  expect(Math.min(...gaps)).toBeLessThan(3000);
});
