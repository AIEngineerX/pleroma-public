import { expect, test, type Page } from "@playwright/test";
import { enterTemple } from "./helpers/door";
import {
  executeD1,
  resetStack,
  seedDream,
  seedKeptRelic,
} from "./helpers/workerFixture";

const BANNED_VISITOR_COPY = [
  { name: "AI-marketing filler", pattern: /\b(?:elevate|seamless|unleash)\b/i },
  { name: "technical implementation paths", pattern: /worker\/src|\/api\/|audio\/[0-9a-f]|system prompt|model id/i },
  { name: "false immediate-incorporation claims", pattern: /took your mark into itself|immediately incorporated|already part of the body/i },
] as const;

async function expectVisibleVisitorCopyToBeClean(page: Page, surface: string): Promise<void> {
  const renderedCopy = await page.locator("body").evaluate((body) => {
    const accessibleLabels = Array.from(body.querySelectorAll("[aria-label], [alt], [title]"))
      .flatMap((node) => ["aria-label", "alt", "title"].map((attribute) => node.getAttribute(attribute)))
      .filter((value): value is string => value !== null);
    return [body.innerText, ...accessibleLabels].join("\n");
  });
  for (const rule of BANNED_VISITOR_COPY) {
    expect(renderedCopy, `${surface} contains ${rule.name}`).not.toMatch(rule.pattern);
  }
}

test.beforeEach(() => {
  resetStack();
  const now = Date.now();
  executeD1("UPDATE config SET value = '1' WHERE key = 'launched';");
  seedKeptRelic({
    id: "interface-copy-relic",
    offering_id: "interface-copy-offering",
    wallet: null,
    summary: "a quiet kept mark",
    rite_id: "2030-01-02",
    kept_at: now,
    genesis: 1,
    accreted_at: null,
  });
  seedDream({
    id: "01JH0000000000000000000099",
    rite_date: "2030-01-02",
    narrative: "A quiet Plate remains in the public record.",
    video_key: null,
    wakers: [],
    status: "composed",
    created_at: now,
  });
});

test("rendered visitor surfaces contain no marketing filler, technical paths, or false incorporation claims", async ({ page }) => {
  await enterTemple(page);

  // Prove the scan reaches hard-coded interface strings outside the centralized copy object.
  await expect(page.locator("[data-relic-awaiting-accretion]")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("region", { name: "the dream" }).locator("figcaption"))
    .toContainText("plate pending");
  await expect(page.getByRole("region", { name: "the market" })).toBeVisible({ timeout: 10_000 });
  await expectVisibleVisitorCopyToBeClean(page, "state-rich Temple");

  const seal = page.getByRole("button", { name: "hold the threshold seal" });
  await seal.focus();
  await page.keyboard.down("Space");
  await page.waitForTimeout(140);
  await page.keyboard.up("Space");
  await expect(page.locator("img[data-threshold-preview]")).toBeVisible();
  await expectVisibleVisitorCopyToBeClean(page, "threshold preview");
  await page.getByRole("button", { name: "let the imprint fade" }).click();

  for (const path of ["/canon", "/canon/dreams", "/concordat"]) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    if (path === "/canon/dreams") {
      await expect(page.getByText("A quiet Plate remains in the public record.")).toBeVisible();
    }
    await expectVisibleVisitorCopyToBeClean(page, path);
  }
});
