import { expect, test } from "@playwright/test";
import { enterTemple } from "./helpers/door";
import AxeBuilder from "@axe-core/playwright";
import { FINANCIAL_PROMISE, PROHIBITED_FINANCIAL_COPY } from "./helpers/copyGuards";

// [day-7 launch] The automated portion of the launch gate (CLAUDE.md "Exit condition" + PLANNING.md
// "Day-7 launch checklist (the gate)"). Run against the real production stack AT OR AFTER the launch
// minute (config `launched`=1 and PULSE_MINT set together, docs/runbooks/launch-day7.md §3) — not run
// against the commit-gate build, which has no mint and reports phase "dormant". The manual gate items
// (moderation exercise, Concordat=code parity, backup restore, stage-criteria freeze, kill criterion) are
// the runbook's job, not this spec's; see docs/runbooks/launch-day7.md for the full checklist this covers.
test("day-7 gate: live temple, pinned mint, vitals, a11y", async ({ page }) => {
  await enterTemple(page);
  const productionApiUrl = process.env.PLEROMA_PRODUCTION_API_URL!;
  const state = await (await page.request.get(`${productionApiUrl.replace(/\/$/, "")}/api/state`)).json();
  expect(state.phase).toBe("live");                 // organs on schedule, launched
  expect(state.mint).toBeTruthy();                  // mint pinned (anti-decoy single source)
  expect(state.vitals).toBeTruthy();                // vitals live on the real mint
  await expect(page.getByText(state.mint)).toBeVisible();         // mint shown, matches the API
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations.filter(v => v.impact === "critical")).toEqual([]);
});

test("day-7 gate: the live market makes no financial promise", async ({ page }) => {
  await enterTemple(page);
  const market = page.getByRole("region", { name: "the market" });
  await expect(market).toBeVisible();
  for (const prohibited of PROHIBITED_FINANCIAL_COPY) {
    expect(prohibited).toMatch(FINANCIAL_PROMISE);
  }
  const doctrineReturn = page.getByText(/DREAM returns the kept as a Plate/);
  await expect(doctrineReturn).toBeVisible();
  expect(await doctrineReturn.innerText()).toMatch(FINANCIAL_PROMISE);
  await expect(market.getByText(/DREAM returns the kept as a Plate/)).toHaveCount(0);
  expect(await market.innerText()).not.toMatch(FINANCIAL_PROMISE);
});
