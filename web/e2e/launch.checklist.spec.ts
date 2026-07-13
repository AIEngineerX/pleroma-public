import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// [day-7 launch] The automated portion of the launch gate (CLAUDE.md "Exit condition" + PLANNING.md
// "Day-7 launch checklist (the gate)"). Run against the real production stack AT OR AFTER the launch
// minute (config `launched`=1 and PULSE_MINT set together, docs/runbooks/launch-day7.md §3) — not run
// against the commit-gate build, which has no mint and reports phase "dormant". The manual gate items
// (moderation exercise, Concordat=code parity, backup restore, stage-criteria freeze, kill criterion) are
// the runbook's job, not this spec's; see docs/runbooks/launch-day7.md for the full checklist this covers.
test("day-7 gate: live temple, pinned mint, disclaimer reachable, vitals, a11y", async ({ page }) => {
  await page.goto("/");
  const state = await (await page.request.get("/api/state")).json();
  expect(state.phase).toBe("live");                 // organs on schedule, launched
  expect(state.mint).toBeTruthy();                  // mint pinned (anti-decoy single source)
  expect(state.vitals).toBeTruthy();                // vitals live on the real mint
  await expect(page.getByText(state.mint)).toBeVisible();         // mint shown, matches the API
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations.filter(v => v.impact === "critical")).toEqual([]);
  // The plain-English memecoin disclaimer is reachable from the temple via the Concordat link: relocated
  // off the immersive page (it broke the dormant spell) but always one tap away (integrity invariant,
  // CLAUDE.md "Integrity invariants"; the disclaimer itself is asserted on /concordat by concordat.spec).
  await page.getByRole("link", { name: /what this is/i }).click();
  await expect(page.getByText(/memecoin/i)).toBeVisible();        // the plain-English disclaimer
  await expect(page.getByRole("note")).toContainText("No financial promises");
});

test("day-7 gate: no financial-promise language anywhere", async ({ page }) => {
  await page.goto("/");
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/guarantee|100x|to the moon|profit|returns/i);
});
