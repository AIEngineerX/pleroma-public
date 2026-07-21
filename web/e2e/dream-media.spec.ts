import { expect, test } from "@playwright/test";
import { enterTemple } from "./helpers/door";
import { putDreamVideo, resetStack, seedDream } from "./helpers/workerFixture";

const FIRST_VIDEO_KEY = "dream/01JH0000000000000000000001.mp4";
const CURRENT_VIDEO_KEY = "dream/01JH0000000000000000000002.mp4";

test.beforeEach(() => {
  resetStack();
  putDreamVideo(FIRST_VIDEO_KEY);
  putDreamVideo(CURRENT_VIDEO_KEY);
  const now = Date.now();
  seedDream({
    id: "01JH0000000000000000000001",
    rite_date: "2030-01-01",
    narrative: "The first Plate keeps its own still record.",
    video_key: FIRST_VIDEO_KEY,
    wakers: [],
    status: "rendered",
    created_at: now - 1_000,
  });
  seedDream({
    id: "01JH0000000000000000000002",
    rite_date: "2030-01-02",
    narrative: "The current Plate moves only while it may be paused.",
    video_key: CURRENT_VIDEO_KEY,
    wakers: [],
    status: "rendered",
    created_at: now,
  });
});

test("real Dream media pauses and only the current non-reduced Plate starts moving", async ({ page }) => {
  await enterTemple(page);
  const current = page.locator('[data-section="dream"] video');
  await expect(current).toBeVisible();
  await expect.poll(() => current.evaluate(node => (node as HTMLVideoElement).readyState))
    .toBeGreaterThanOrEqual(2);
  expect(await current.evaluate(node => ({
    controls: (node as HTMLVideoElement).controls,
    autoplay: (node as HTMLVideoElement).autoplay,
  }))).toEqual({ controls: true, autoplay: true });
  await expect.poll(() => current.evaluate(node => {
    const video = node as HTMLVideoElement;
    return {
      paused: video.paused,
      muted: video.muted,
      defaultMuted: video.defaultMuted,
      readyState: video.readyState,
      networkState: video.networkState,
      error: video.error?.message ?? null,
    };
  })).toMatchObject({ paused: false, muted: true, defaultMuted: true, error: null });
  await expect.poll(() => current.evaluate(node => (node as HTMLVideoElement).currentTime))
    .toBeGreaterThan(0);
  await page.locator('[data-section="dream"]')
    .screenshot({ path: `e2e/__shots__/dream-current-${test.info().project.name}.png` });
  await current.focus();
  await page.keyboard.press("Space");
  await expect.poll(() => current.evaluate(node => (node as HTMLVideoElement).paused)).toBe(true);
  const pausedAt = await current.evaluate(node => (node as HTMLVideoElement).currentTime);
  await page.waitForTimeout(250);
  expect(await current.evaluate(node => (node as HTMLVideoElement).currentTime)).toBeCloseTo(pausedAt, 1);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(current).toBeVisible();
  await expect.poll(() => current.evaluate(node => (node as HTMLVideoElement).readyState))
    .toBeGreaterThanOrEqual(2);
  expect(await current.evaluate(node => ({
    controls: (node as HTMLVideoElement).controls,
    autoplay: (node as HTMLVideoElement).autoplay,
    paused: (node as HTMLVideoElement).paused,
    currentTime: (node as HTMLVideoElement).currentTime,
  }))).toEqual({ controls: true, autoplay: false, paused: true, currentTime: 0 });

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/canon/dreams");
  const archive = page.locator("video");
  await expect(archive).toHaveCount(2);
  await expect.poll(() => archive.evaluateAll(nodes => nodes.every(node => (
    (node as HTMLVideoElement).readyState >= 2
  )))).toBe(true);
  expect(await archive.evaluateAll(nodes => nodes.map(node => ({
    controls: (node as HTMLVideoElement).controls,
    autoplay: (node as HTMLVideoElement).autoplay,
    paused: (node as HTMLVideoElement).paused,
    currentTime: (node as HTMLVideoElement).currentTime,
  })))).toEqual([
    { controls: true, autoplay: false, paused: true, currentTime: 0 },
    { controls: true, autoplay: false, paused: true, currentTime: 0 },
  ]);
});

// The room quiets when a voice plays (2026-07-21): unmuting the moving Plate ducks the ambient
// bed, re-muting releases it. body[data-audio-ducked] is the ducking system's observable truth
// (lib/ambient.ts duckAmbient) and tracks the logical state whether or not audio was ever primed,
// so this pins the hold-count balancing without needing real sound in the harness.
test("an unmuted playing Plate ducks the room; re-muting releases it", async ({ page }) => {
  await enterTemple(page);
  const current = page.locator('[data-section="dream"] video');
  await expect(current).toBeVisible();
  await expect.poll(() => current.evaluate(node => !(node as HTMLVideoElement).paused)).toBe(true);
  expect(await page.evaluate(() => document.body.hasAttribute("data-audio-ducked"))).toBe(false);
  await current.evaluate(node => { (node as HTMLVideoElement).muted = false; });
  await expect.poll(() => page.evaluate(() => document.body.hasAttribute("data-audio-ducked"))).toBe(true);
  await current.evaluate(node => { (node as HTMLVideoElement).muted = true; });
  await expect.poll(() => page.evaluate(() => document.body.hasAttribute("data-audio-ducked"))).toBe(false);
});

// The dated permalink /canon/dreams#YYYY-MM-DD must actually land on its Plate: entries load
// async after mount and Lenis eats native fragment jumps, so the archive scrolls there itself.
test("a dated dream permalink scrolls to its own Plate in the archive", async ({ page }) => {
  await page.goto("/canon/dreams#2030-01-01");
  const plate = page.locator('[id="2030-01-01"]');
  await expect(plate).toBeVisible({ timeout: 10_000 });
  // The page actually scrolled toward the anchored plate rather than resting at the top of the
  // list, and the plate ends up within the viewport once media has laid out.
  await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 10_000 }).toBeGreaterThan(0);
  await expect.poll(async () => {
    const box = await plate.boundingBox();
    const viewport = page.viewportSize();
    if (box === null || viewport === null) return false;
    return box.y < viewport.height && box.y + box.height > 0;
  }, { timeout: 10_000 }).toBe(true);
});
