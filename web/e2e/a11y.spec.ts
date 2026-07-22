import { expect, test } from "@playwright/test";
import { enterTemple } from "./helpers/door";
import AxeBuilder from "@axe-core/playwright";
import { executeD1, resetStack } from "./helpers/workerFixture";

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
  await enterTemple(page);
  // One in-page pass instead of a protocol round-trip per element: the per-element boundingBox()
  // loop alone blew the 30s test budget on the congested shared CI runner.
  const tooSmall = await page.evaluate(() => {
    const visible = (el: Element) => {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    return [...document.querySelectorAll("a, button, summary, [role='button']")]
      .filter(visible)
      .map((el) => ({ el, rect: el.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width < 44 || rect.height < 44)
      .map(({ el, rect }) =>
        `${el.tagName}:${(el.textContent ?? "").trim().slice(0, 40)} ${Math.round(rect.width)}x${Math.round(rect.height)}`);
  });
  expect(tooSmall).toEqual([]);
  const seal = page.getByRole("button", { name: "hold the threshold seal" });
  // The door was entered by pointer, which switches Chromium's modality heuristic away from
  // keyboard; one key press restores it so :focus-visible shows the ring a keyboard user sees.
  await page.keyboard.press("Tab");
  await seal.focus();
  expect(await seal.evaluate(node => getComputedStyle(node).outlineStyle)).toBe("solid");
  const wrongFont = await page.evaluate(() => {
    const visible = (el: Element) => {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    return [...document.querySelectorAll("button, summary")]
      .filter(visible)
      .filter((el) => !getComputedStyle(el).fontFamily.toLowerCase().includes("courier prime"))
      .map((el) => `${el.tagName}:${(el.textContent ?? "").trim().slice(0, 40)}`);
  });
  expect(wrongFont).toEqual([]);
});

// The offer button (the one real rite a visitor performs) must sit in thumb reach on a 390px
// viewport: within the bottom ~75% of the screen, not stranded up near the notch (mobile-responsive-audit).
test("the offer button is in thumb reach at 390px", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-390", "thumb reach is a mobile-390 concern");
  await enterTemple(page);
  const offer = page.getByRole("button", { name: "hold the threshold seal" });
  await expect(offer).toBeVisible();
  const box = (await offer.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.y).toBeGreaterThan(viewport.height * 0.25); // clear of the top quarter (notch/status bar reach)
});

test("the 390px document scrolls without overflow or sticky-body overlap", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-390", "mobile geometry is a mobile-390 concern");
  await enterTemple(page);
  const viewport = page.viewportSize()!;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);

  const codex = page.locator('[data-section="codex"]');
  await codex.evaluate(node => node.scrollIntoView({ block: "start", behavior: "instant" }));
  const bodyBox = (await page.locator("[data-body-page]").boundingBox())!;
  const codexBox = (await codex.boundingBox())!;
  expect(codexBox.y).toBeGreaterThanOrEqual(bodyBox.y + bodyBox.height - 1);

  const before = await page.evaluate(() => window.scrollY);
  await page.evaluate(() => window.scrollBy({ top: 160, behavior: "auto" }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
  const overlap = await page.evaluate(() => {
    const body = document.querySelector<HTMLElement>("[data-body-page]")!;
    const reading = document.querySelector<HTMLElement>("[data-reading-column]")!;
    const codex = document.querySelector<HTMLElement>('[data-section="codex"]')!;
    const bodyRect = body.getBoundingClientRect();
    const codexRect = codex.getBoundingClientRect();
    const pointY = Math.min(bodyRect.bottom - 24, Math.max(24, codexRect.top + 24));
    // Sample clear paper away from the centered threshold seal, which intentionally shares this layer.
    const pointX = bodyRect.left + bodyRect.width * 0.8;
    const topmost = document.elementFromPoint(pointX, pointY);
    return {
      codexPassesUnderBody: codexRect.top < bodyRect.bottom,
      topmostIsBody: topmost?.closest("[data-body-page]") === body,
      topmost: topmost instanceof HTMLElement
        ? { tag: topmost.tagName, className: topmost.className, thresholdPhase: topmost.dataset.thresholdPhase ?? null }
        : null,
      point: { x: pointX, y: pointY },
      bodyRect: { top: bodyRect.top, bottom: bodyRect.bottom },
      codexRect: { top: codexRect.top, bottom: codexRect.bottom },
      bodyZ: Number.parseInt(getComputedStyle(body).zIndex, 10),
      readingZ: Number.parseInt(getComputedStyle(reading).zIndex, 10),
      bodyGround: getComputedStyle(body).backgroundColor,
    };
  });
  expect(overlap.codexPassesUnderBody).toBe(true);
  expect(overlap.topmostIsBody, JSON.stringify(overlap, null, 2)).toBe(true);
  expect(overlap.bodyZ).toBeGreaterThan(overlap.readingZ);
  expect(overlap.bodyGround).not.toBe("rgba(0, 0, 0, 0)");
});

test("the live market disclosure keeps its native marker and state", async ({ page }) => {
  executeD1("UPDATE config SET value = '1' WHERE key = 'launched';");
  await enterTemple(page);
  const market = page.getByRole("region", { name: "the market" });
  await expect(market).toBeVisible({ timeout: 10_000 });
  const summary = market.locator("summary");
  await expect(summary).toHaveCSS("display", "list-item");
  expect((await summary.evaluate(node => getComputedStyle(node).fontFamily)).toLowerCase())
    .toContain("courier prime");
  const details = market.locator("details");
  await expect(details).not.toHaveAttribute("open", "");
  await summary.click();
  await expect(details).toHaveAttribute("open", "");
});

test("reduced-motion holds the Stain still (no canvas sim)", async ({ browser }, testInfo) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await enterTemple(page);
  // Scope the assertion to the first-sheet temple so later drawing canvases do not affect this check.
  const stainCanvas = page.getByRole("region", { name: "the temple" }).locator("canvas");
  await expect(stainCanvas).toHaveCount(0); // reduced-motion creates no GL context
  const settled = page.getByRole("region", { name: "the temple" }).locator("svg.swarm-settled");
  await expect(settled).toBeVisible();
  await expect(settled).toHaveCSS("z-index", "0");
  await expect(settled).toHaveCSS("pointer-events", "none");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe("auto");
  await page.screenshot({ path: `e2e/__shots__/reduced-motion-${testInfo.project.name}.png` });
  await ctx.close();
});
