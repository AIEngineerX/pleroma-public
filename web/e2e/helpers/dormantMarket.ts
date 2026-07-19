import { expect, type Page } from "@playwright/test";

// The dormant placeholder (256a46f) legitimately owns the "the market" landmark while there is
// no mint: the honest "no heart yet" line, and a real countdown only once the Maker sets one.
// These specs used to assert the landmark was absent outright; the invariant that actually
// matters is that no tradable surface leaks while dormant — no buy link, no chart, no mint pin.
export async function expectDormantMarketOnly(page: Page): Promise<void> {
  const market = page.getByRole("region", { name: "the market" });
  await expect(market).toHaveCount(1);
  await expect(market).toContainText("It has no heart yet. There is no mint, and nothing to buy.");
  await expect(market.getByRole("link")).toHaveCount(0);
  await expect(market.getByRole("button")).toHaveCount(0);
  await expect(market.locator("iframe, code")).toHaveCount(0);
}
