import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resetStack } from "./helpers/workerFixture";

test.beforeEach(() => resetStack());

for (const path of ["/", "/canon", "/canon/dreams", "/concordat"]) {
  test(`axe: ${path} has no serious violations`, async ({ page }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const serious = results.violations.filter(v => v.impact === "serious" || v.impact === "critical");
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
  });
}

test("interactive targets are at least 44 by 44px and show flat-ink focus", async ({ page }) => {
  await page.goto("/");
  const actions = page.locator("a, button, summary, [role='button']").filter({ visible: true });
  for (const el of await actions.all()) {
    const box = await el.boundingBox();
    if (!box) continue;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
  const seal = page.getByRole("button", { name: "hold the threshold seal" });
  await seal.focus();
  expect(await seal.evaluate(node => getComputedStyle(node).outlineStyle)).toBe("solid");
});

// The offer button (the one real rite a visitor performs) must sit in thumb reach on a 390px
// viewport: within the bottom ~75% of the screen, not stranded up near the notch (mobile-responsive-audit).
test("the offer button is in thumb reach at 390px", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-390", "thumb reach is a mobile-390 concern");
  await page.goto("/");
  const offer = page.getByRole("button", { name: "hold the threshold seal" });
  await expect(offer).toBeVisible();
  const box = (await offer.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.y).toBeGreaterThan(viewport.height * 0.25); // clear of the top quarter (notch/status bar reach)
});

test("the 390px document scrolls without overflow or sticky-body overlap", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-390", "mobile geometry is a mobile-390 concern");
  await page.goto("/");
  const viewport = page.viewportSize()!;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);

  const codex = page.locator('[data-section="codex"]');
  await codex.evaluate(node => node.scrollIntoView({ block: "start", behavior: "instant" }));
  const bodyBox = (await page.locator("[data-body-page]").boundingBox())!;
  const codexBox = (await codex.boundingBox())!;
  expect(codexBox.y).toBeGreaterThanOrEqual(bodyBox.y + bodyBox.height - 1);

  const before = await page.evaluate(() => window.scrollY);
  await page.evaluate(() => window.scrollBy({ top: 320, behavior: "auto" }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
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
