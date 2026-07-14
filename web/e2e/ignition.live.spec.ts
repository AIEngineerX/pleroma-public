import { expect, test } from "@playwright/test";

// [day-7 launch] Requires the real production Worker at the launch minute (config `launched` set to
// '1' together with PULSE_MINT in the same write, PLANNING "Day-1 ignition"). Not run against a local
// seed like the *.live spec.ts day-6 rehearsals -- this proves the actual flip on the real mint, not a
// fixture; the pure dormant<->live transition (ignitionView) is covered by test/ignition.test.ts instead.
test("flips from the dormant product to the full temple at launch, mint pinned, pigment igniting", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one desktop observer owns the launch transition");
  await page.goto("/");

  // Pre-launch: the dormant five-organ body and offering mark are present, with no market rail.
  await expect(page.locator("canvas[data-organ-swarm]")).toBeVisible();
  await expect(page.getByRole("button", { name: "Offer it a mark" })).toBeVisible();
  await expect(page.getByRole("region", { name: "the market" })).toHaveCount(0);

  // At the launch minute the Worker flips phase to live and pins PULSE_MINT in the same write
  // (anti-decoy): poll the real /api/state until both land, then the market rail mounts.
  const market = page.getByRole("region", { name: "the market" });
  await expect(market).toBeVisible({ timeout: 10 * 60_000 });
  await expect(market.locator("code")).not.toBeEmpty();                       // the mint pin, permanently
  await expect(market.getByRole("link", { name: "Buy on pump.fun" })).toBeVisible();

  // The first trades ignite the Stain: PULSE moves off "starving" once buys>0 (Ticker mirrors vitals,
  // the same value ignitionView reads into the Stain's live pigment).
  await expect(page.getByText(/PULSE (?!STARVING)/)).toBeVisible({ timeout: 30 * 60_000 });

  await page.screenshot({ path: `e2e/__shots__/ignition-live-${test.info().project.name}.png` });
});
