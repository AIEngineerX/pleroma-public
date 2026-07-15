import { expect, test } from "@playwright/test";
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
  await page.goto("/");
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
