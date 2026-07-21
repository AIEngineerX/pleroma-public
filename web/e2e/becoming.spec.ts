import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { executeD1, resetStack, seedKeptRelic } from "./helpers/workerFixture";

test.beforeEach(() => resetStack());

// /becoming is a standalone route (no Door gating, unlike the Temple) — go straight there and wait
// for the same live fetch the component itself waits on, mirroring stain.spec.ts's baseline pattern.
async function gotoBecoming(page: Page): Promise<void> {
  const relics = page.waitForResponse((response) => response.url().includes("/api/relics") && response.ok());
  await page.goto("/becoming", { waitUntil: "commit" });
  await relics;
}

// One wrangler call for N relics rather than N seedKeptRelic calls (each its own process spawn) —
// same inline multi-row INSERT pattern as dream-convergence.live.spec.ts's newerRows, needed only at
// the density the seeded-density regression test below requires.
function seedManyKeptRelics(prefix: string, count: number, baseAt: number): void {
  const offeringRows: string[] = [];
  const relicRows: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = `${prefix}${String(index).padStart(3, "0")}`;
    const keptAt = baseAt + index;
    offeringRows.push(
      `('${id}', NULL, NULL, 'offerings/${id}', 'sha-${id}', 'kept', 0, ${keptAt}, ${keptAt}, 'image/png', NULL, NULL)`,
    );
    relicRows.push(`('${id}-relic', '${id}', NULL, 'a welded mark', NULL, ${keptAt}, 0, NULL)`);
  }
  executeD1(`
    INSERT INTO offerings (id, wallet, sig, image_key, sha256, status, attempts, created_at, perceived_at, media_type, nonce, claimed_at)
    VALUES ${offeringRows.join(",\n")};
    INSERT INTO relics (id, offering_id, wallet, summary, rite_id, kept_at, genesis, accreted_at)
    VALUES ${relicRows.join(",\n")};
  `);
}

async function axeSeriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
}

test("the empty body reads as quiet, not dead, with no horizontal overflow", async ({ page }) => {
  await gotoBecoming(page);
  const becoming = page.locator("[data-becoming]");
  await expect(becoming).toBeVisible();
  await expect(becoming).toHaveAttribute("data-becoming-piece-count", "0");
  await expect(page.locator("[data-becoming-piece]")).toHaveCount(0);
  await expect(page.locator("[data-becoming-caption]")).toHaveText("The body has not yet begun. No mark has been kept.");
  const viewport = page.viewportSize()!;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
});

test("each real kept relic welds one piece into the body", async ({ page }) => {
  const now = Date.now();
  seedKeptRelic({
    id: "becoming-genesis-relic", offering_id: "becoming-genesis-offering", wallet: null,
    summary: "the founding mark", rite_id: "2030-02-01", kept_at: now, genesis: 1, accreted_at: null,
  });
  seedKeptRelic({
    id: "becoming-second-relic", offering_id: "becoming-second-offering", wallet: null,
    summary: "a later mark", rite_id: "2030-02-01", kept_at: now + 1, genesis: 0, accreted_at: null,
  });
  seedKeptRelic({
    id: "becoming-third-relic", offering_id: "becoming-third-offering", wallet: null,
    summary: "another mark", rite_id: "2030-02-01", kept_at: now + 2, genesis: 0, accreted_at: null,
  });

  await gotoBecoming(page);
  const becoming = page.locator("[data-becoming]");
  await expect(becoming).toHaveAttribute("data-becoming-piece-count", "3");
  await expect(becoming).toHaveAttribute("aria-label", "The Becoming — 3 marks welded into the still-unfinished body");
  await expect(page.locator("[data-becoming-piece]")).toHaveCount(3);
  await expect(page.locator('[data-becoming-piece="becoming-genesis-offering"]')).toHaveAttribute("data-genesis", "");
  await expect(page.locator("[data-becoming-caption]")).toHaveText(
    "3 marks have been welded into the still-unfinished body.",
  );
});

test("prefers-reduced-motion settles the body and mounts no canvas", async ({ browser }) => {
  const now = Date.now();
  seedKeptRelic({
    id: "becoming-reduced-relic", offering_id: "becoming-reduced-offering", wallet: null,
    summary: "a still mark", rite_id: "2030-02-02", kept_at: now, genesis: 1, accreted_at: null,
  });
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await gotoBecoming(page);
  const becoming = page.locator("[data-becoming]");
  await expect(becoming).toHaveAttribute("data-motion", "still");
  await expect(page.locator("[data-becoming-canvas]")).toHaveCount(0);
  await ctx.close();
});

test("permanent WebGL loss leaves the SVG as the rendered truth", async ({ page }) => {
  const now = Date.now();
  seedKeptRelic({
    id: "becoming-loss-relic", offering_id: "becoming-loss-offering", wallet: null,
    summary: "a welded mark", rite_id: "2030-02-03", kept_at: now, genesis: 1, accreted_at: null,
  });
  await gotoBecoming(page);
  const canvas = page.locator("[data-becoming-canvas]");
  await expect(canvas).toBeVisible();

  const lost = await canvas.evaluate((node: HTMLCanvasElement) => {
    const gl = node.getContext("webgl2");
    const extension = gl?.getExtension("WEBGL_lose_context");
    if (extension === null || extension === undefined) return false;
    extension.loseContext();
    return true;
  });
  expect(lost).toBe(true);

  await expect(page.locator("[data-becoming-canvas]")).toHaveCount(0);
  const becoming = page.locator("[data-becoming]");
  await expect(becoming).toBeVisible();
  await expect(becoming).toHaveAttribute("data-becoming-piece-count", "1");
  await expect(page.locator("[data-becoming-piece]")).toHaveCount(1);
});

test("axe: /becoming has no serious violations", async ({ page }) => {
  const now = Date.now();
  seedKeptRelic({
    id: "becoming-axe-relic", offering_id: "becoming-axe-offering", wallet: null,
    summary: "a witnessed mark", rite_id: "2030-02-04", kept_at: now, genesis: 1, accreted_at: null,
  });
  await gotoBecoming(page);
  const serious = await axeSeriousViolations(page);
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
});

// Seeded-density regression (CLAUDE.md: any element over the being's own generative form must stay
// legible at seeded density extremes, pinned by a test rather than an eyeball — the same rule that
// cost the Threshold consent line six regressions). Empty and dense (>=50 pieces) are the two extremes
// the machine-font caption sits across; both must keep the caption present and the page axe-clean.
for (const density of ["empty", "dense"] as const) {
  test(`the caption stays present and axe-clean at ${density} density`, async ({ page }) => {
    if (density === "dense") seedManyKeptRelics("becoming-dense-", 50, Date.now());

    await gotoBecoming(page);
    const becoming = page.locator("[data-becoming]");
    await expect(becoming).toHaveAttribute("data-becoming-piece-count", density === "dense" ? "50" : "0");

    const caption = page.locator("[data-becoming-caption]");
    await expect(caption).toBeVisible();
    expect((await caption.evaluate((node) => getComputedStyle(node).fontFamily)).toLowerCase())
      .toContain("courier prime");

    const serious = await axeSeriousViolations(page);
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
  });
}
