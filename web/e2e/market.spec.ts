import { expect, test } from "@playwright/test";
import type { TempleState } from "../src/state/types";

// No live Worker in this run (see stain.spec.ts/one-glance.spec.ts): a static state fixture served
// by the preview itself (Step 4's documented alternative), so this runs in the standard commit gate
// rather than needing a seeded live Worker like the *.live.spec.ts files.
const MINT = "MintPubkey1111111111111111111111111111111";
const LIVE_STATE: TempleState = {
  phase: "live", asleep: false, degraded: false, countdown_to: null, communicants_today: 12,
  spend_state: "ok", mint: MINT,
  vitals: { state: "fed", buys: 9, sells: 3, holders: 41 },
  rite: null, dream: null,
};

test("the market rail renders once live: mint pin + copy, buy, ledger-plate chart, ticker, disclaimer", async ({ page }) => {
  await page.route("**/api/state", (r) => r.fulfill({ json: LIVE_STATE }));
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
  await page.goto("/"); // no route mock: state stays null, same as the other dormant specs
  await expect(page.getByRole("region", { name: "the market" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /what this is/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /On X/ })).toBeVisible();
});

test("no price predictions or returns language appear anywhere on the page", async ({ page }) => {
  await page.route("**/api/state", (r) => r.fulfill({ json: LIVE_STATE }));
  await page.goto("/");
  await expect(page.getByRole("region", { name: "the market" })).toBeVisible();
  const bodyText = await page.locator("body").innerText();
  expect(bodyText).not.toMatch(/guarantee|returns|profit|moon|100x/i);
});
