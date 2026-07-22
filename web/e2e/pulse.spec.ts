import { expect, test } from "@playwright/test";
import { enterTemple } from "./helpers/door";
import { expectDormantMarketOnly } from "./helpers/dormantMarket";
import { executeD1, resetStack } from "./helpers/workerFixture";

test.beforeEach(() => resetStack());

// PULSE gets its own always-visible home (unlike Buy/Chart/Mint, it needs no mint to be truthful).
// Dormant = no mint pinned = no heart yet: the section draws the flat quiet baseline and the
// "not yet reported" line, never a beat — even though the Worker defaults vitals to "starving"
// pre-launch (the beat begins only when the mint pin flips dormant off; the flip rehearsal covers
// that side). These tests pin the dormant truth without ever mentioning buys/sells/holders/mint.
test("the Pulse section is visible while dormant, shows DOCTRINE's rubric line and the flat no-heart line, and never leaks market numbers", async ({ page }) => {
  await enterTemple(page);

  const pulse = page.getByRole("region", { name: "the pulse" });
  await expect(pulse).toBeVisible();
  await expect(pulse).toContainText("My heart is a public number. To be watched is how I stay alive.");
  // No mint pinned: the feed presents as unknown and the quiet baseline draws — no beat, no bpm.
  await expect(pulse).toHaveAttribute("data-pulse-feed", "unknown");
  await expect(pulse).toContainText("The Pulse has not yet reported.");
  await expect(pulse.locator(".pulse-trace--quiet")).toHaveCount(1);
  await expect(pulse.locator("[data-pulse-trace]")).toHaveCount(0);
  await expect(pulse).not.toContainText("bpm");

  const pulseText = (await pulse.innerText()).toLowerCase();
  expect(pulseText).not.toContain("buys");
  expect(pulseText).not.toContain("sells");
  expect(pulseText).not.toContain("holders");
  expect(pulseText).not.toContain("mint");

  // The market landmark must still be only the honest dormant placeholder — this section is not
  // a backdoor to the gated rail.
  await expectDormantMarketOnly(page);

  await pulse.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `e2e/__shots__/pulse-${test.info().project.name}.png` });
});

test("a real state change while still dormant stays hidden — the heart starts only at launch", async ({ page }) => {
  executeD1(`
    UPDATE config
       SET value = '{"state":"feasting","holders":41,"updated_at":${Date.now()}}'
     WHERE key = 'pulse_state';
  `);
  await enterTemple(page);

  // The state exists in D1, but with no mint pinned the section must keep the flat line: showing
  // FEASTING before launch would be a heartbeat with no heart.
  const pulse = page.getByRole("region", { name: "the pulse" });
  await expect(pulse).toContainText("The Pulse has not yet reported.");
  await expect(pulse).toHaveAttribute("data-pulse-feed", "unknown");
  await expect(pulse).not.toContainText("FEASTING");
  await expect(pulse).not.toContainText("bpm");
  await expectDormantMarketOnly(page);
});

test("the dormant Pulse is inert under reduced motion — the flat line never animates", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await enterTemple(page);
  const pulse = page.getByRole("region", { name: "the pulse" });
  // No beating wave exists dormant; the quiet baseline itself carries no animation to suppress.
  await expect(pulse.locator("[data-pulse-trace]")).toHaveCount(0);
  const quiet = pulse.locator(".pulse-trace--quiet");
  const animationName = await quiet.evaluate((node) => getComputedStyle(node).animationName);
  expect(animationName).toBe("none");
});
