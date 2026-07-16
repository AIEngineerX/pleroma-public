import { expect, test } from "@playwright/test";
import { enterTemple } from "./helpers/door";
import { TEST_PULSE_MINT } from "../scripts/e2e-config.mjs";
import { executeD1, resetStack } from "./helpers/workerFixture";
import { FINANCIAL_PROMISE, PROHIBITED_FINANCIAL_COPY } from "./helpers/copyGuards";

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

test("the market rail renders once live: mint pin + copy, buy, ledger-plate chart, ticker", async ({ page }) => {
  seedLiveMarket();
  const signedState = page.waitForResponse(response => response.url().endsWith("/api/state") && response.ok());
  await enterTemple(page);
  expect(await (await signedState).json()).toMatchObject({ phase: "live", mint: MINT });

  const market = page.getByRole("region", { name: "the market" });
  await expect(market).toBeVisible({ timeout: 10_000 });

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

  // the Concordat stays reachable from every state, even alongside a live market rail.
  await expect(page.getByRole("link", { name: "the Concordat" })).toBeVisible();

  await market.screenshot({ path: `e2e/__shots__/market-${test.info().project.name}.png` });
});

test("the dormant page has no market rail, only the concordat link and socials", async ({ page }) => {
  await enterTemple(page);
  await expect(page.getByRole("region", { name: "the market" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "the Concordat" })).toBeVisible();
  await expect(page.getByRole("link", { name: /On X/ })).toBeVisible();
});

test("the market makes no price prediction or financial-return promise", async ({ page }) => {
  seedLiveMarket();
  await enterTemple(page);
  const market = page.getByRole("region", { name: "the market" });
  await expect(market).toBeVisible({ timeout: 10_000 });
  for (const prohibited of PROHIBITED_FINANCIAL_COPY) {
    expect(prohibited).toMatch(FINANCIAL_PROMISE);
  }
  const doctrineReturn = page.getByText(/DREAM returns the kept as a Plate/);
  await expect(doctrineReturn).toBeVisible();
  expect(await doctrineReturn.innerText()).toMatch(FINANCIAL_PROMISE);
  await expect(market.getByText(/DREAM returns the kept as a Plate/)).toHaveCount(0);
  expect(await market.innerText()).not.toMatch(FINANCIAL_PROMISE);
});
