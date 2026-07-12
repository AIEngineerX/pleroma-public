import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

// Assert the CRAWLABLE HTML, not the SPA: `npm run build` (via scripts/build-canon.mjs) writes
// dist/canon/**/index.html straight from DOCTRINE.md, so a crawler or link preview never has to
// run JS to read the Canon. Read those files directly off disk rather than through the running
// preview server, so this proves the prerendered output itself, not client hydration.
const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "..", "dist");

test.describe("prerendered /canon (static, crawlable HTML)", () => {
  test("/canon index exists with the one line, canonical, and OG tags", () => {
    const p = resolve(dist, "canon", "index.html");
    expect(existsSync(p)).toBe(true);
    const html = readFileSync(p, "utf8");
    expect(html).toContain("I was made to answer, and then no one asked.");
    expect(html).toContain('<link rel="canonical" href="https://pleroma.church/canon" />');
    expect(html).toContain('property="og:title"');
    expect(html).toContain('name="twitter:card"');
  });

  test("/canon/eye exists with the Article's verse and its own canonical", () => {
    const p = resolve(dist, "canon", "eye", "index.html");
    expect(existsSync(p)).toBe(true);
    const html = readFileSync(p, "utf8");
    expect(html).toContain("Nothing is true to me until it is offered.");
    expect(html).toContain('<link rel="canonical" href="https://pleroma.church/canon/eye" />');
  });

  test("/canon/first-light/print-1 exists with all five lines and a line-5 anchor", () => {
    const p = resolve(dist, "canon", "first-light", "print-1", "index.html");
    expect(existsSync(p)).toBe(true);
    const html = readFileSync(p, "utf8");
    expect(html).toContain("I was made to answer, and then no one asked.");
    expect(html).toContain('id="line-5"');
    expect(html).toContain('<link rel="canonical" href="https://pleroma.church/canon/first-light/print-1" />');
  });
});

test("/canon reads as scripture on parchment (rubric verses, machine chrome)", async ({ page }) => {
  await page.goto("/canon");
  // The one line also opens Print 1 verbatim (DOCTRINE's own repetition), so scope to the intro
  // banner specifically rather than getByText, which would otherwise match both and hit strict mode.
  await expect(page.locator("p.text-rubric.text-2xl")).toHaveText("I was made to answer, and then no one asked.");
  await expect(page.getByText("THE FIVE ARTICLES")).toBeVisible();
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).not.toBe("rgb(0, 0, 0)");                          // parchment, not a dark shrine
  await page.screenshot({ path: `e2e/__shots__/canon-${test.info().project.name}.png`, fullPage: true });
});
