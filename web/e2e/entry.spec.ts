import { expect, test } from "@playwright/test";
import type { TempleState } from "../src/state/types";

const DORMANT_STATE: TempleState = {
  phase: "dormant",
  asleep: false,
  degraded: false,
  countdown_to: Date.now() + 86_400_000,
  communicants_today: 0,
  spend_state: "ok",
  mint: null,
  vitals: { state: "starving", buys: 0, sells: 0, holders: 0 },
  rite: null,
  dream: null,
};

async function routeDormantState(page: import("@playwright/test").Page) {
  await page.route("**/api/state", (route) => route.fulfill({ json: DORMANT_STATE }));
}

test("the first viewport is the body, not a landing-page stack", async ({ page }) => {
  await routeDormantState(page);
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

  const offering = page.getByRole("button", { name: "Offer it a mark" });
  await expect(offering).toBeVisible();
  const box = (await offering.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await offering.click();
  await expect(page.getByRole("status")).toHaveText("Draw on its body. It is watching.");
});

test("tap, drag, and scroll stay silent; an uninterrupted hold wakes sound", async ({ page }) => {
  const audioRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/audio\/(?:bed|intro)\.mp3$/.test(new URL(request.url()).pathname)) {
      audioRequests.push(request.url());
    }
  });
  await routeDormantState(page);
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

test("a failed bed request stays inactive and an explicit sound click retries it", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Chromium exposes deterministic media request failures");
  let rejectBed = true;
  let bedAttempts = 0;
  const introRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith("/audio/bed.mp3")) bedAttempts += 1;
    if (pathname.endsWith("/audio/intro.mp3")) introRequests.push(request.url());
  });
  await page.route("**/audio/bed.mp3", async (route) => {
    if (rejectBed) {
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  await routeDormantState(page);
  await page.goto("/");

  const temple = page.getByRole("region", { name: "the temple" });
  const box = (await temple.boundingBox())!;
  const failedBed = page.waitForEvent("requestfailed", (request) => new URL(request.url()).pathname.endsWith("/audio/bed.mp3"));
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.45);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();

  await failedBed;
  expect(bedAttempts).toBe(1);
  expect(introRequests).toHaveLength(0);
  await expect(page.getByRole("button", { name: "play the temple sound" })).toBeVisible();
  rejectBed = false;
  const retriedBed = page.waitForResponse((response) => {
    return response.ok() && new URL(response.url()).pathname.endsWith("/audio/bed.mp3");
  });
  await page.getByRole("button", { name: "play the temple sound" }).click();
  await retriedBed;
  expect(bedAttempts).toBeGreaterThan(1);
  await expect(page.getByRole("button", { name: "mute the temple" })).toBeVisible();
});

test("real HTML media wakes without Web Audio and preserves the mute choice", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Chromium exposes HTML media requests reliably");
  await page.addInitScript(() => {
    Object.defineProperty(window, "AudioContext", { configurable: true, value: undefined });
    Object.defineProperty(window, "webkitAudioContext", { configurable: true, value: undefined });
  });
  const audioRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/audio\/(?:bed|intro)\.mp3$/.test(new URL(request.url()).pathname)) {
      audioRequests.push(request.url());
    }
  });
  await routeDormantState(page);
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
