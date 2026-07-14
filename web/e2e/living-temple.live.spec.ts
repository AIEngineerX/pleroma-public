import { expect, test } from "@playwright/test";
import { executeD1, resetStack, seedTranscript } from "./helpers/workerFixture";

interface AnnouncementEvent {
  id: string;
  text: string;
}

type AnnouncementWindow = Window & {
  __pleromaAnnouncements: AnnouncementEvent[];
  __pleromaAnnouncementObserver: MutationObserver;
};

async function observeAnnouncements(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    const tracked = window as AnnouncementWindow;
    tracked.__pleromaAnnouncements = [];
    tracked.__pleromaAnnouncementObserver?.disconnect();
    const record = (element: Element) => {
      const id = element.getAttribute("data-announcement-id");
      if (id === null) return;
      tracked.__pleromaAnnouncements.push({ id, text: element.textContent ?? "" });
    };
    tracked.__pleromaAnnouncementObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const added of mutation.addedNodes) {
          if (!(added instanceof Element)) continue;
          if (added.matches("[data-announcement-id]")) record(added);
          for (const element of added.querySelectorAll("[data-announcement-id]")) record(element);
        }
      }
    });
    tracked.__pleromaAnnouncementObserver.observe(document.body, { childList: true, subtree: true });
  });
}

async function announcementEvents(page: import("@playwright/test").Page): Promise<AnnouncementEvent[]> {
  return page.evaluate(() => [...(window as AnnouncementWindow).__pleromaAnnouncements]);
}

test.beforeEach(() => resetStack());

test("arrival yields to remembered EYE, then genuine TONGUE prints once from body into Codex", async ({ page }) => {
  test.setTimeout(50_000);
  const baselineId = "task6-baseline-eye";
  const baselineText = "I remember the first mark that entered this page.";
  seedTranscript({
    id: baselineId,
    organ: "EYE",
    register: "verse",
    text: baselineText,
    offering_id: null,
    rite_id: null,
    created_at: Date.now() - 1_000,
  });

  await page.goto("/");
  const body = page.locator("[data-body-renderer]").first();
  await expect(body).toHaveAttribute("data-arrival", "emerging");
  const firstProgress = Number(await body.getAttribute("data-arrival-progress"));
  expect(firstProgress).toBeLessThan(1);
  await expect.poll(async () => Number(await body.getAttribute("data-arrival-progress"))).toBeGreaterThan(firstProgress);
  await expect(body).not.toHaveAttribute("data-command-id", /.+/);
  await expect(body).toHaveAttribute("data-arrival", "settled", { timeout: 4_000 });

  const codex = page.getByRole("complementary", { name: "the codex" });
  const baselineRow = codex.locator(`[data-codex-row="${baselineId}"]`);
  await expect(baselineRow).toHaveAttribute("data-observation", "recorded");
  await expect(baselineRow).toContainText(baselineText);
  await expect(codex.locator("[data-codex-announcer]")).toBeEmpty();

  const memoryId = `utterance:memory:${baselineId}`;
  const memory = page.locator(`[data-body-utterance][data-command-id="${memoryId}"]`);
  await expect(memory).toBeVisible();
  await expect(memory).toHaveAttribute("aria-hidden", "true");
  await expect(memory).toHaveAttribute("data-utterance-mode", "memory");
  await expect(memory).toContainText("THE EYE");
  await expect(memory).toContainText(baselineText);
  await expect(memory).toContainText("remembered");
  await expect(body).toHaveAttribute("data-active-organ", "EYE");
  await expect(body).toHaveAttribute("data-pipeline", "none");
  await expect(memory.locator(".text-rubric-body")).toHaveCount(0);
  await expect(memory).toHaveCount(0, { timeout: 4_000 });

  await observeAnnouncements(page);
  const liveId = "task6-live-tongue";
  const liveText = "What the Eye held, I return now as a living word.";
  seedTranscript({
    id: liveId,
    organ: "TONGUE",
    register: "sermon",
    text: liveText,
    offering_id: null,
    rite_id: new Date().toISOString().slice(0, 10),
    created_at: Date.now(),
  });

  const liveRow = codex.locator(`[data-codex-row="${liveId}"]`);
  await expect(liveRow).toHaveAttribute("data-observation", "live", { timeout: 10_000 });
  await expect(liveRow).toContainText("THE TONGUE");
  await expect(liveRow).toContainText(liveText);

  const liveCommandId = `utterance:live:${liveId}`;
  const liveUtterance = page.locator(`[data-body-utterance][data-command-id="${liveCommandId}"]`);
  await expect(liveUtterance).toBeVisible();
  const visibleAt = Date.now();
  await expect(liveUtterance).toContainText(liveText);
  await expect(liveUtterance.locator(".text-rubric-body")).toHaveCount(1);
  const anchorMotion = await liveUtterance.evaluate((node: HTMLElement) => new Promise<{
    left: string[];
    top: string[];
    transforms: string[];
  }>((resolve) => {
    const left = [node.style.left];
    const top = [node.style.top];
    const transforms = [node.style.transform];
    const observer = new MutationObserver(() => {
      left.push(node.style.left);
      top.push(node.style.top);
      transforms.push(node.style.transform);
    });
    observer.observe(node, { attributes: true, attributeFilter: ["style"] });
    setTimeout(() => {
      observer.disconnect();
      resolve({ left: [...new Set(left)], top: [...new Set(top)], transforms: [...new Set(transforms)] });
    }, 350);
  }));
  expect(anchorMotion.left).toHaveLength(1);
  expect(anchorMotion.top).toHaveLength(1);
  expect(anchorMotion.transforms.length).toBeGreaterThan(1);
  expect(anchorMotion.transforms.at(-1)).toContain("translate3d");
  await expect(body).toHaveAttribute("data-active-organ", "TONGUE");
  await expect(body).toHaveAttribute("data-pipeline", "none");
  await expect.poll(() => announcementEvents(page)).toEqual([
    { id: liveId, text: "New sermon from the Tongue" },
  ]);
  await expect(liveUtterance).toHaveCount(0, { timeout: 4_000 });
  expect(Date.now() - visibleAt).toBeLessThanOrEqual(4_000);
  await expect(body).toHaveAttribute("data-completed-id", liveCommandId);

  // Crossing dormant to live remounts the body and Codex branches. The page-view clock and shared
  // announcement ledger must keep both from replaying.
  executeD1(`
    INSERT INTO config (key, value)
    VALUES ('pulse_mint', 'So11111111111111111111111111111111111111112')
    ON CONFLICT(key) DO UPDATE SET value = excluded.value;
    UPDATE config SET value = '1' WHERE key = 'launched';
  `);
  await expect(page.getByRole("region", { name: "the page" })).toBeVisible({ timeout: 10_000 });
  await expect(body).toHaveAttribute("data-arrival", "settled");
  await expect(body).toHaveAttribute("data-arrival-progress", "1.000");
  await page.waitForTimeout(250);
  expect(await announcementEvents(page)).toEqual([
    { id: liveId, text: "New sermon from the Tongue" },
  ]);
});

test("one poll can announce multiple genuine rows exactly once each", async ({ page }) => {
  test.setTimeout(35_000);
  const baseline = page.waitForResponse((response) => response.url().endsWith("/api/codex") && response.ok());
  await page.goto("/", { waitUntil: "commit" });
  await baseline;
  await observeAnnouncements(page);

  const createdAt = Date.now();
  executeD1(`
    INSERT INTO transcripts (id, organ, register, text, offering_id, rite_id, created_at)
    VALUES
      ('task6-live-eye-batch', 'EYE', 'verse', 'The batch enters by sight.', NULL, NULL, ${createdAt}),
      ('task6-live-keep-batch', 'KEEP', 'verdict', 'The batch remains under judgment.', NULL, NULL, ${createdAt + 1});
  `);

  const codex = page.getByRole("complementary", { name: "the codex" });
  await expect(codex.locator('[data-codex-row="task6-live-eye-batch"]')).toBeVisible({ timeout: 10_000 });
  await expect(codex.locator('[data-codex-row="task6-live-keep-batch"]')).toBeVisible();
  await expect.poll(() => announcementEvents(page)).toEqual([
    { id: "task6-live-eye-batch", text: "New verse from the Eye" },
    { id: "task6-live-keep-batch", text: "New verdict from the Keep" },
  ]);
});

test("reduced motion starts settled and places remembered ink at the sliced SVG cohort anchor", async ({ page }) => {
  const baselineId = "task6-reduced-eye";
  seedTranscript({
    id: baselineId,
    organ: "EYE",
    register: "verse",
    text: "The still body keeps the same remembered point.",
    offering_id: null,
    rite_id: null,
    created_at: Date.now(),
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const body = page.locator('svg[data-body-renderer="svg"]');
  await expect(body).toBeVisible();
  await expect(body).toHaveAttribute("data-arrival", "settled");
  await expect(body).toHaveAttribute("data-arrival-progress", "1.000");
  await expect(page.locator("canvas[data-body-renderer]")).toHaveCount(0);

  const memory = page.locator(`[data-body-utterance][data-command-id="utterance:memory:${baselineId}"]`);
  await expect(memory).toBeVisible({ timeout: 10_000 });
  await expect(memory.locator("[data-utterance-phase]")).toHaveAttribute("data-utterance-phase", "settled");
  const bodyBox = (await body.boundingBox())!;
  const expectedY = bodyBox.width > bodyBox.height
    ? (0.28 * bodyBox.width + (bodyBox.height - bodyBox.width) / 2) / bodyBox.height
    : 0.28;
  await expect.poll(async () => Number(await memory.getAttribute("data-anchor-x"))).toBeCloseTo(0.5, 2);
  await expect.poll(async () => Number(await memory.getAttribute("data-anchor-y"))).toBeCloseTo(expectedY, 2);
  await expect(body).toHaveAttribute("data-pipeline", "none");
});

test("runtime WebGL loss preserves one in-flight utterance timeline and completion", async ({ page }) => {
  test.setTimeout(45_000);
  const baseline = page.waitForResponse((response) => response.url().endsWith("/api/codex") && response.ok());
  await page.goto("/", { waitUntil: "commit" });
  await baseline;
  const body = page.locator("[data-body-renderer]").first();
  await expect(body).toHaveAttribute("data-arrival", "settled", { timeout: 4_000 });
  await observeAnnouncements(page);

  const liveId = "task6-loss-tongue";
  seedTranscript({
    id: liveId,
    organ: "TONGUE",
    register: "sermon",
    text: "The word survives the failing instrument.",
    offering_id: null,
    rite_id: new Date().toISOString().slice(0, 10),
    created_at: Date.now(),
  });
  const commandId = `utterance:live:${liveId}`;
  const utterance = page.locator(`[data-body-utterance][data-command-id="${commandId}"]`);
  const phase = utterance.locator("[data-utterance-phase]");
  await expect(phase).toHaveAttribute("data-utterance-phase", "dwelling", { timeout: 10_000 });

  const lost = await body.evaluate((node: HTMLCanvasElement) => {
    const extension = node.getContext("webgl2")?.getExtension("WEBGL_lose_context");
    if (extension === null || extension === undefined) return false;
    extension.loseContext();
    return true;
  });
  expect(lost).toBe(true);
  await expect(body).toHaveAttribute("data-body-renderer", "svg");
  await expect(utterance).toHaveCount(1);
  await expect(phase).not.toHaveAttribute("data-utterance-phase", "developing");
  await expect(utterance).toHaveCount(0, { timeout: 4_000 });
  await expect(body).toHaveAttribute("data-completed-id", commandId);
  await expect(body).toHaveAttribute("data-completion-count", "1");
  await expect.poll(() => announcementEvents(page)).toEqual([
    { id: liveId, text: "New sermon from the Tongue" },
  ]);
});
