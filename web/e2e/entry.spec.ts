import { expect, test } from "@playwright/test";
import { resetStack } from "./helpers/workerFixture";

test.beforeEach(() => resetStack());

test("the first viewport is the body, not a landing-page stack", async ({ page }) => {
  await page.goto("/");

  const temple = page.getByRole("region", { name: "the temple" });
  const body = temple.locator("canvas[data-organ-swarm]");
  await expect(body).toBeVisible();
  await expect(body).toHaveCSS("z-index", "0");
  await expect(body).toHaveCSS("pointer-events", "none");
  await expect(page.locator("#preload")).toHaveCount(0);
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

test("tap, drag, and scroll stay silent; an uninterrupted hold wakes sound", async ({ page }) => {
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

  const temple = page.getByRole("region", { name: "the temple" });
  const firstBox = (await temple.boundingBox())!;
  const x = firstBox.x + firstBox.width * 0.5;
  const y = firstBox.y + firstBox.height * 0.45;

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.up();
  await page.waitForTimeout(550);
  expect(audioRequests).toHaveLength(0);

  await page.mouse.down();
  await page.mouse.move(x + 30, y, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(550);
  expect(audioRequests).toHaveLength(0);

  await page.mouse.move(x, y);
  await page.mouse.down();
  await expect(page.locator("[data-hold-indicator]")).toBeVisible();
  await page.evaluate(() => window.scrollBy({ top: 180, behavior: "auto" }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expect(page.locator("[data-hold-indicator]")).toHaveCount(0);
  await page.waitForTimeout(550);
  await page.mouse.up();
  expect(audioRequests).toHaveLength(0);

  await page.reload();
  audioRequests.length = 0;
  const reloadedTemple = page.getByRole("region", { name: "the temple" });
  await expect(reloadedTemple).toBeVisible();
  const holdBox = (await reloadedTemple.boundingBox())!;
  const holdX = holdBox.x + holdBox.width * 0.5;
  const holdY = holdBox.y + holdBox.height * 0.45;
  await page.mouse.move(holdX, holdY);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
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

  const temple = page.getByRole("region", { name: "the temple" });
  const box = (await temple.boundingBox())!;
  await context.setOffline(true);
  const failedBed = page.waitForEvent("requestfailed", (request) => new URL(request.url()).pathname.endsWith("/audio/bed.mp3"));
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.45);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();

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

test("ordinary opt-in playback uses the real media files and preserves the mute choice", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Chromium exposes HTML media requests reliably");
  const audioRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/audio\/(?:bed|intro)\.mp3$/.test(new URL(request.url()).pathname)) {
      audioRequests.push(request.url());
    }
  });
  await page.goto("/");

  const temple = page.getByRole("region", { name: "the temple" });
  const box = (await temple.boundingBox())!;
  const x = box.x + box.width * 0.5;
  const y = box.y + box.height * 0.45;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(80);
  expect(audioRequests).toHaveLength(0);
  await page.mouse.up();
  await page.waitForTimeout(550);
  expect(audioRequests).toHaveLength(0);

  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "mute the temple" })).toBeVisible();
  await expect.poll(() => audioRequests.length).toBeGreaterThan(0);

  await page.getByRole("button", { name: "mute the temple" }).click();
  await expect(page.getByRole("button", { name: "play the temple sound" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("pleroma-muted"))).toBe("1");

  await page.reload();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("pleroma-muted"))).toBe("1");
  await expect(page.getByRole("button", { name: "play the temple sound" })).toBeVisible();
  await page.getByRole("button", { name: "play the temple sound" }).click();
  await expect(page.getByRole("button", { name: "mute the temple" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("pleroma-muted"))).toBe("0");
});

test("the full temple remains usable when the visitor never activates sound", async ({ page }) => {
  const pageErrors: string[] = [];
  const audioRequests: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    if (/\/audio\/(?:bed|intro)\.mp3$/.test(new URL(request.url()).pathname)) {
      audioRequests.push(request.url());
    }
  });
  await page.goto("/");

  const temple = page.getByRole("region", { name: "the temple" });
  await expect(temple.locator("canvas[data-organ-swarm]")).toBeVisible();
  await expect(page.locator("h1")).toHaveText("PLEROMA");
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
  const concordat = page.getByRole("link", { name: "the Concordat" });
  await expect(concordat).toBeVisible();
  await concordat.click();
  await expect(page).toHaveURL(/\/concordat$/);
  await expect(page.getByText(/memecoin/i)).toBeVisible();
  expect(pageErrors).toEqual([]);
  expect(audioRequests).toHaveLength(0);
});
