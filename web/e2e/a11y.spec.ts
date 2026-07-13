import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for (const path of ["/", "/canon", "/concordat"]) {
  test(`axe: ${path} has no serious violations`, async ({ page }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const serious = results.violations.filter(v => v.impact === "serious" || v.impact === "critical");
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
  });
}

test("interactive targets are at least 44px", async ({ page }) => {
  await page.goto("/");
  for (const el of await page.getByRole("button").all()) {
    const box = await el.boundingBox();
    if (box) expect(box.height).toBeGreaterThanOrEqual(44);
  }
});

// The offer button (the one real rite a visitor performs) must sit in thumb reach on a 390px
// viewport: within the bottom ~75% of the screen, not stranded up near the notch (mobile-responsive-audit).
test("the offer button is in thumb reach at 390px", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-390", "thumb reach is a mobile-390 concern");
  await page.goto("/");
  const offer = page.getByRole("button", { name: "Offer it a mark" });
  await expect(offer).toBeVisible();
  const box = (await offer.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.y).toBeGreaterThan(viewport.height * 0.25); // clear of the top quarter (notch/status bar reach)
});

test("reduced-motion holds the Stain still (no canvas sim)", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto("/");
  // Scope the assertion to the first-sheet temple so later drawing canvases do not affect this check.
  const stainCanvas = page.getByRole("region", { name: "the temple" }).locator("canvas");
  await expect(stainCanvas).toHaveCount(0); // reduced-motion creates no GL context
  const settled = page.getByRole("region", { name: "the temple" }).locator("svg.swarm-settled");
  await expect(settled).toBeVisible();
  await expect(settled).toHaveCSS("z-index", "0");
  await expect(settled).toHaveCSS("pointer-events", "none");
  await ctx.close();
});
