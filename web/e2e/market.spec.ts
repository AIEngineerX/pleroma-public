import { expect, test } from "@playwright/test";
import { TEST_PULSE_MINT } from "../scripts/e2e-stack.mjs";
import { executeD1, resetStack } from "./helpers/workerFixture";

const MINT = TEST_PULSE_MINT;

test.beforeEach(() => resetStack());

function seedLiveMarket(): void {
  const now = Date.now();
  executeD1(`
    UPDATE config SET value = '1' WHERE key = 'launched';
    UPDATE config
       SET value = '{"state":"fed","holders":41,"updated_at":${now}}'
     WHERE key = 'pulse_state';
  `);
}

test("the market rail renders once live: mint pin + copy, buy, ledger-plate chart, ticker, disclaimer", async ({ page }) => {
  seedLiveMarket();
  await page.goto("/");

  const market = page.getByRole("region", { name: "the market" });
  await expect(market).toBeVisible();

  // mint: permanently pinned, one-tap copy >=44px (thumb reach at 390px).
  await expect(market.locator("code")).toHaveText(MINT);
  const copyBtn = market.getByRole("button", { name: "Copy the mint" });
  const copyBox = (await copyBtn.boundingBox())!;
  expect(copyBox.height).toBeGreaterThanOrEqual(44);

  // buy: pump.fun link, correct mint, safe rel.
  const buy = market.getByRole("link", { name: "Buy on pump.fun" });
  await expect(buy).toHaveAttribute("href", `https://pump.fun/coin/${MINT}`);
  await expect(buy).toHaveAttribute("rel", "noopener noreferrer");

  // chart: ledger plate with a titled iframe and an open-chart link.
  const chartFrame = market.locator("iframe");
  await expect(chartFrame).toHaveAttribute("title", "the ledger");
  await expect(chartFrame).toHaveAttribute("src", new RegExp(`${MINT}.*embed=1`));

  // ticker: the Courier vitals line for the literal-minded.
  await expect(market.getByText(/PULSE FED/)).toBeVisible();

  // disclaimer: reachable from every state via the Concordat link (the plain-English memecoin disclaimer
  // lives on /concordat now; see concordat.spec.ts), even alongside a live market rail.
  await expect(page.getByRole("link", { name: /what this is/i })).toBeVisible();

  await market.screenshot({ path: `e2e/__shots__/market-${test.info().project.name}.png` });
});

test("the dormant page has no market rail, only the concordat link and socials", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("region", { name: "the market" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /what this is/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /On X/ })).toBeVisible();
});

test("no price predictions or returns language appear anywhere on the page", async ({ page }) => {
  seedLiveMarket();
  await page.goto("/");
  await expect(page.getByRole("region", { name: "the market" })).toBeVisible();
  const bodyText = await page.locator("body").innerText();
  expect(bodyText).not.toMatch(/guarantee|returns|profit|moon|100x/i);
});
