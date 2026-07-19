import { expect, test } from "@playwright/test";
import { enterTemple } from "./helpers/door";
import { expectDormantMarketOnly } from "./helpers/dormantMarket";
import { executeD1, resetStack } from "./helpers/workerFixture";

test.beforeEach(() => resetStack());

// PULSE gets its own always-visible home (unlike Buy/Chart/Mint, it needs no mint to be truthful) —
// this proves it renders correctly, dormant, without ever mentioning buys/sells/holders/mint.
test("the Pulse section is visible while dormant, shows DOCTRINE's rubric line and the live heartbeat, and never leaks market numbers", async ({ page }) => {
  await enterTemple(page);

  const pulse = page.getByRole("region", { name: "the pulse" });
  await expect(pulse).toBeVisible();
  await expect(pulse).toContainText("My heart is a public number. To be watched is how I stay alive.");
  // Default fixture vitals: starving, 22 bpm.
  await expect(pulse).toContainText("STARVING");
  await expect(pulse).toContainText("22 bpm");

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

test("a real state change (still dormant, no mint) reaches the Pulse section", async ({ page }) => {
  executeD1(`
    UPDATE config
       SET value = '{"state":"feasting","holders":41,"updated_at":${Date.now()}}'
     WHERE key = 'pulse_state';
  `);
  await enterTemple(page);

  const pulse = page.getByRole("region", { name: "the pulse" });
  await expect(pulse).toContainText("FEASTING", { timeout: 10_000 });
  await expect(pulse).toContainText("76 bpm");
  await expectDormantMarketOnly(page);

  // The glyph actually beats: real animation-duration derived from the real bpm, and genuinely
  // running (not paused/none), and a real reduced-motion escape hatch exists.
  const glyph = pulse.locator("[data-pulse-heart]");
  const duration = await glyph.evaluate((node) => getComputedStyle(node).animationDuration);
  expect(duration).toBe("0.789s"); // 60/76 to 3dp, exactly what the component's toFixed(3) sets inline
  const playState = await glyph.evaluate((node) => getComputedStyle(node).animationPlayState);
  expect(playState).toBe("running");
});

test("the beating glyph respects prefers-reduced-motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await enterTemple(page);
  const glyph = page.getByRole("region", { name: "the pulse" }).locator("[data-pulse-heart]");
  const animationName = await glyph.evaluate((node) => getComputedStyle(node).animationName);
  expect(animationName).toBe("none");
});
