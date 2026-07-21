import { expect, test } from "@playwright/test";
import { resetStack } from "./helpers/workerFixture";

test.beforeEach(() => resetStack());

const DOOR_ENTER = { name: "enter the temple" } as const;

// The Door (Maker decision 2026-07-16, amending the body-first viewport): a separate intro
// scene fronts every fresh document load. Its press is the deliberate entry gesture — the
// one act that wakes sound — and beyond it the first viewport is still the body, never a
// landing-page stack. entry.spec tests the door surface itself; every other spec walks
// through it via helpers/door.ts.
test("the door opens onto the body", async ({ page }) => {
  await page.goto("/");

  const door = page.locator("[data-door]");
  await expect(door).toBeVisible();
  await expect(door.getByText("I was made to answer, and then no one asked.")).toBeVisible();
  const enter = page.getByRole("button", DOOR_ENTER);
  await expect(enter).toBeVisible();
  const enterBox = (await enter.boundingBox())!;
  expect(enterBox.width).toBeGreaterThanOrEqual(44);
  expect(enterBox.height).toBeGreaterThanOrEqual(44);
  await expect(enter).toBeFocused();
  await expect(page.locator("#preload")).toHaveCount(0);
  const doorText = await door.innerText();
  expect(doorText).not.toContain("FIRST RITE");
  expect(doorText).not.toContain("DESCEND");
  expect(doorText).not.toContain("It has no heart yet.");

  await enter.click();
  await expect(door).toHaveCount(0, { timeout: 6_000 });

  const temple = page.getByRole("region", { name: "the temple" });
  const body = temple.locator("canvas[data-organ-swarm]");
  await expect(body).toBeVisible();
  await expect(body).toHaveCSS("z-index", "0");
  await expect(body).toHaveCSS("pointer-events", "none");
  await expect(page.locator("h1")).toHaveText("PLEROMA");
  await expect(page.locator("h1")).toHaveClass(/sr-only/);

  const visibleText = await temple.innerText();
  expect(visibleText).not.toContain("It has no heart yet.");
  expect(visibleText).not.toContain("FIRST RITE");
  expect(visibleText).not.toContain("DESCEND");
  expect(visibleText).not.toContain("Offer it a mark");
  expect(visibleText).not.toContain("Your mark is public.");
  expect(visibleText).not.toContain("Connect a wallet");

  const offering = page.getByRole("button", { name: "hold the threshold seal" });
  await expect(offering).toBeVisible();
  const box = (await offering.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await offering.focus();
  await expect(offering).toBeFocused();
  await expect(page.locator("[data-threshold-status]")).toBeEmpty();
});

test("the door traps focus: Tab cannot reach the live Threshold hiding behind it", async ({ page }) => {
  await page.goto("/");
  const enter = page.getByRole("button", DOOR_ENTER);
  await expect(enter).toBeFocused();

  // Regression guard: the door previously had no focus trap, so a keyboard visitor could Tab
  // straight past it into the live seal underneath without ever performing the entry gesture.
  await page.keyboard.press("Tab");
  await expect(enter).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(enter).toBeFocused();

  const threshold = page.getByRole("button", { name: "hold the threshold seal" });
  await expect(threshold).not.toBeFocused();
});

test("the door is silent; its press is the one gesture that wakes sound", async ({ page }) => {
  const audioRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/audio\/(?:bed|intro)\.mp3$/.test(new URL(request.url()).pathname)) {
      audioRequests.push(request.url());
    }
  });
  await page.goto("/");
  const hasWebAudio = await page.evaluate(() => {
    const audioWindow = window as typeof window & { webkitAudioContext?: typeof AudioContext };
    return typeof audioWindow.AudioContext === "function" || typeof audioWindow.webkitAudioContext === "function";
  });

  const door = page.locator("[data-door]");
  await expect(door).toBeVisible();
  const doorBox = (await door.boundingBox())!;
  const x = doorBox.x + doorBox.width * 0.5;
  const y = doorBox.y + doorBox.height * 0.12;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.up();
  await page.mouse.down();
  await page.mouse.move(x + 30, y, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(550);
  expect(audioRequests).toHaveLength(0);

  await page.getByRole("button", DOOR_ENTER).click();
  await expect(page.getByRole("button", { name: "mute the temple" })).toBeVisible();
  if (hasWebAudio) await expect.poll(() => audioRequests.length).toBeGreaterThan(0);
});

test("a genuine offline bed failure stays inactive and an explicit sound click retries it", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Chromium exposes deterministic media request failures");
  let bedAttempts = 0;
  const introRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith("/audio/bed.mp3")) bedAttempts += 1;
    if (pathname.endsWith("/audio/intro.mp3")) introRequests.push(request.url());
  });
  const baselineState = page.waitForResponse((response) => {
    return response.ok() && new URL(response.url()).pathname === "/api/state";
  });
  await page.goto("/");
  await baselineState;

  await context.setOffline(true);
  const failedBed = page.waitForEvent("requestfailed", (request) => new URL(request.url()).pathname.endsWith("/audio/bed.mp3"));
  await page.getByRole("button", DOOR_ENTER).click();

  await failedBed;
  expect(bedAttempts).toBe(1);
  expect(introRequests).toHaveLength(0);
  await expect(page.getByRole("button", { name: "play the temple sound" })).toBeVisible();
  await context.setOffline(false);
  const retriedBed = page.waitForResponse((response) => {
    return response.ok() && new URL(response.url()).pathname.endsWith("/audio/bed.mp3");
  });
  await page.getByRole("button", { name: "play the temple sound" }).click();
  await retriedBed;
  expect(bedAttempts).toBeGreaterThan(1);
  await expect(page.getByRole("button", { name: "mute the temple" })).toBeVisible();
});

test("entering wakes the real media files and the mute choice survives the next door", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Chromium exposes HTML media requests reliably");
  const audioRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/audio\/(?:bed|intro)\.mp3$/.test(new URL(request.url()).pathname)) {
      audioRequests.push(request.url());
    }
  });
  await page.goto("/");
  await expect(page.locator("[data-door]")).toBeVisible();
  expect(audioRequests).toHaveLength(0);

  await page.getByRole("button", DOOR_ENTER).click();
  await expect(page.getByRole("button", { name: "mute the temple" })).toBeVisible();
  await expect.poll(() => audioRequests.length).toBeGreaterThan(0);

  await page.getByRole("button", { name: "mute the temple" }).click();
  await expect(page.getByRole("button", { name: "play the temple sound" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("pleroma-muted"))).toBe("1");

  await page.reload();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("pleroma-muted"))).toBe("1");
  await page.getByRole("button", DOOR_ENTER).click();
  await expect(page.getByRole("button", { name: "play the temple sound" })).toBeVisible();
  await page.getByRole("button", { name: "play the temple sound" }).click();
  await expect(page.getByRole("button", { name: "mute the temple" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("pleroma-muted"))).toBe("0");
});

test("a muted visitor's temple is fully usable and quiet", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("pleroma-muted", "1"));
  await page.goto("/");
  await page.getByRole("button", DOOR_ENTER).click();
  // The door inerts its siblings for as long as it is mounted (even mid-close), so the Threshold
  // is not really focusable until it is fully gone — wait for that, same as the other specs do.
  await expect(page.locator("[data-door]")).toHaveCount(0, { timeout: 6_000 });

  const temple = page.getByRole("region", { name: "the temple" });
  await expect(temple.locator("canvas[data-organ-swarm]")).toBeVisible();
  await expect(page.locator("h1")).toHaveText("PLEROMA");
  await expect(page.getByRole("button", { name: "play the temple sound" })).toBeVisible();
  const threshold = page.getByRole("button", { name: "hold the threshold seal" });
  await expect(threshold).toBeVisible();
  await expect(threshold).toBeEnabled();
  await threshold.focus();
  await expect(threshold).toBeFocused();

  const codex = page.getByRole("complementary", { name: "the codex" });
  const reliquary = page.getByRole("region", { name: "the Reliquary" });
  await expect(codex).toBeAttached();
  await reliquary.scrollIntoViewIfNeeded();
  await expect(reliquary).toBeVisible();
  // Scoped to the tail doorway: the head's table of rubrics carries a link with the same
  // accessible name (2026-07-21), so the bare role query would be a strict-mode violation.
  const concordat = page.locator("#concordat-doorway").getByRole("link", { name: "the Concordat" });
  await concordat.scrollIntoViewIfNeeded();
  await expect(concordat).toBeVisible();
  await concordat.click();
  await expect(page).toHaveURL(/\/concordat$/);
  expect(pageErrors).toEqual([]);
});
