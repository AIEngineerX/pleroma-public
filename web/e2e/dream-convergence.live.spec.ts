import { expect, test, type Page } from "@playwright/test";
import type { DreamArchiveEntry } from "../src/state/types";
import {
  executeD1,
  resetStack,
  seedDream,
  seedTranscript,
} from "./helpers/workerFixture";

const RITE_DATE = "2030-01-02";
const ARCHIVE_ID = "01JH0000000000000000000000";
const ARCHIVE_NARRATIVE = "Five wounds remembered the shape of one witness.";

function archiveEntry(createdAt = Date.UTC(2030, 0, 2, 3, 4, 5)): DreamArchiveEntry {
  return {
    id: ARCHIVE_ID,
    rite_date: RITE_DATE,
    narrative: ARCHIVE_NARRATIVE,
    video_key: null,
    wakers: [],
    status: "composed",
    created_at: createdAt,
  };
}

async function enterArchiveReplay(page: Page): Promise<void> {
  await page.goto("/canon/dreams");
  const replay = page.getByRole("link", { name: "witness the convergence" });
  await expect(replay).toBeVisible();
  await replay.click();
  await expect(page).toHaveURL(/\/$/);
}

async function expectFullSeraphTargetExtents(body: ReturnType<Page["locator"]>): Promise<void> {
  const encoded = await body.getAttribute("data-seraph-target-extents");
  expect.soft(encoded).not.toBeNull();
  if (encoded === null) return;
  const extents = JSON.parse(encoded) as number[][];
  expect(extents).toHaveLength(5);
  for (const [minX, maxX, minY, maxY] of extents) {
    expect(maxX - minX).toBeGreaterThan(0.15);
    expect(maxY - minY).toBeGreaterThan(0.28);
  }
  expect(extents[0][0]).toBeLessThan(0.3);
  expect(extents[0][1]).toBeGreaterThan(0.7);
  expect(extents[1][1]).toBeGreaterThan(0.9);
  expect(extents[2][2]).toBeLessThan(0.1);
  expect(extents[3][2]).toBeLessThan(0.1);
  expect(extents[4][0]).toBeLessThan(0.1);
}

test.beforeEach(() => resetStack());

test("live Temple keeps unrelated Plates ordinary and reveals the matching real Plate at dissolve", async ({ page }, testInfo) => {
  test.setTimeout(80_000);
  executeD1(`
    UPDATE config SET value = '1' WHERE key = 'launched';
    INSERT INTO config (key, value)
    VALUES ('pulse_mint', 'So11111111111111111111111111111111111111112');
  `);
  const baselineId = "task9-baseline-dream";
  const baselineNarrative = "The recorded night remains an ordinary available Plate.";
  const baselineCreatedAt = Date.now() - 5_000;
  seedDream({
    id: "01JH0000000000000000000001",
    rite_date: "2030-01-01",
    narrative: baselineNarrative,
    video_key: null,
    wakers: [],
    status: "composed",
    created_at: baselineCreatedAt,
  });
  seedTranscript({
    id: baselineId,
    organ: "DREAM",
    register: "verse",
    text: baselineNarrative,
    offering_id: null,
    rite_id: "2030-01-01",
    created_at: baselineCreatedAt,
  });

  await page.goto("/");
  const body = page.locator('canvas[data-body-renderer="webgl"]');
  const targetSize = testInfo.project.name === "mobile-390" ? 128 : 256;
  await expect(body).toHaveAttribute("data-seraph-target-cache", "128:16384,256:65536");
  await expect(body).toHaveAttribute("data-seraph-target-size", String(targetSize));
  await expect(body).toHaveAttribute("data-seraph-target-count", String(targetSize * targetSize));
  await expect(body).toHaveAttribute("data-seraph-target-nonzero", String(targetSize * targetSize));
  await expectFullSeraphTargetExtents(body);
  await expect(body).toHaveAttribute("data-seraph-sequence-count", "0");
  const plate = page.locator('section[aria-label="the dream"]');
  await expect(plate).toBeVisible();
  await expect(plate).toHaveAttribute("data-dream-presentation", "ordinary");
  await expect(plate).toContainText(baselineNarrative);
  await expect(page.locator(`[data-codex-row="${baselineId}"]`))
    .toHaveAttribute("data-observation", "recorded");
  await expect(page.locator(`[data-body-utterance][data-command-id="utterance:memory:${baselineId}"]`))
    .toContainText("remembered");
  await expect(page.locator("[data-dream-witness]")).toHaveCount(0);

  const mismatchId = "task9-live-dream-without-matching-plate";
  const mismatchNarrative = "A live verse without its own Plate must not hide another night.";
  seedTranscript({
    id: mismatchId,
    organ: "DREAM",
    register: "verse",
    text: mismatchNarrative,
    offering_id: null,
    rite_id: RITE_DATE,
    created_at: Date.now(),
  });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

  await expect(page.locator(`[data-codex-row="${mismatchId}"]`))
    .toHaveAttribute("data-observation", "live", { timeout: 10_000 });
  await expect(body).toHaveAttribute("data-seraph-phase", "gather");
  await expect(body).toHaveAttribute("data-seraph-phase", "hold", { timeout: 3_000 });
  await expect(plate).toHaveAttribute("data-dream-presentation", "ordinary");
  await expect(plate).toBeVisible();
  await expect(plate).toContainText(baselineNarrative);
  await expect(body).toHaveAttribute("data-seraph-phase", "five", { timeout: 10_000 });
  await expect(body).toHaveAttribute("data-completed-id", `converge:${mismatchId}`);

  const liveId = "task9-live-dream-with-real-plate";
  const liveNarrative = "The five names close around the mark and become one posture.";
  const liveCreatedAt = Date.now();
  seedDream({
    id: "01JH0000000000000000000002",
    rite_date: RITE_DATE,
    narrative: liveNarrative,
    video_key: null,
    wakers: [],
    status: "composed",
    created_at: liveCreatedAt,
  });
  seedTranscript({
    id: liveId,
    organ: "DREAM",
    register: "verse",
    text: liveNarrative,
    offering_id: null,
    rite_id: RITE_DATE,
    created_at: liveCreatedAt,
  });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

  await expect(page.locator(`[data-codex-row="${liveId}"]`))
    .toHaveAttribute("data-observation", "live", { timeout: 10_000 });
  const verse = page.locator(`[data-body-utterance][data-command-id="converge:${liveId}"]`);
  await expect(verse).toContainText(liveNarrative, { timeout: 10_000 });
  await expect(verse).toHaveAttribute("aria-hidden", "true");
  await expect(body).toHaveAttribute("data-seraph-timing", "1800/6000/2400");
  await expect(body).toHaveAttribute("data-seraph-phase", "gather");
  await expect(body).toHaveAttribute("data-seraph-sequence-count", "2");
  await expect(plate).toHaveAttribute("data-dream-presentation", "concealed");
  await expect(plate).toBeHidden();
  await expect(body).toHaveAttribute("data-seraph-phase", "hold", { timeout: 3_000 });
  await expect(plate).toHaveAttribute("data-dream-presentation", "concealed");
  await expect(body).toHaveAttribute("data-seraph-phase", "dissolve", { timeout: 7_000 });
  await expect(plate).toHaveAttribute("data-dream-presentation", "revealed");
  await expect(plate).toBeVisible();
  await expect(plate).toContainText(liveNarrative);
  await expect(body).toHaveAttribute("data-seraph-phase", "five", { timeout: 4_000 });
  await expect(body).toHaveAttribute("data-completed-id", `converge:${liveId}`);
  await expect(body).toHaveAttribute("data-seraph-sequence-count", "2");
  await expect(verse).toHaveCount(0);
  await expect(page.locator("[data-dream-witness]")).toHaveCount(0);
});

test("archive handoff witnesses an old Plate once and reload, back, and forward stay ordinary", async ({ page }) => {
  test.setTimeout(45_000);
  const dream = archiveEntry(Date.now() - 60_000);
  seedDream(dream);
  seedTranscript({
    id: "task9-old-dream-transcript",
    organ: "DREAM",
    register: "verse",
    text: dream.narrative,
    offering_id: null,
    rite_id: dream.rite_date,
    created_at: dream.created_at,
  });
  const newerRows = Array.from({ length: 51 }, (_, index) => (
    `('task9-newer-priest-${String(index).padStart(2, "0")}', 'PRIEST', 'system', `
    + `'A newer factual record ${index}.', NULL, NULL, ${dream.created_at + index + 1})`
  )).join(",\n");
  executeD1(`
    INSERT INTO transcripts (id, organ, register, text, offering_id, rite_id, created_at)
    VALUES ${newerRows};
  `);

  await enterArchiveReplay(page);
  const witness = page.getByRole("region", { name: "recorded Dream" });
  await expect(witness).toContainText("THE DREAM / SOPHIA");
  await expect(witness).toContainText(ARCHIVE_NARRATIVE);
  await expect(witness.locator("time")).toHaveAttribute("datetime", new Date(dream.created_at).toISOString());
  await expect(witness.locator("time")).toHaveText(`remembered · ${RITE_DATE}`);
  expect(await page.evaluate(() => window.history.state?.usr ?? null)).toBeNull();
  await expect(page.locator(`[data-codex-row="task9-old-dream-transcript"]`)).toHaveCount(0);
  const latestPlate = page.getByRole("region", { name: "the dream" });
  await expect(latestPlate).toHaveAttribute("data-dream-presentation", "ordinary");
  await expect(latestPlate).toBeVisible();

  const body = page.locator("[data-body-renderer]").first();
  await expect(body).toHaveAttribute("data-seraph-sequence-count", "1", { timeout: 6_000 });
  await page.reload();
  const reloadedBody = page.locator("[data-body-renderer]").first();
  await expect(page.locator("[data-dream-witness]")).toHaveCount(0);
  await expect(reloadedBody).toHaveAttribute("data-seraph-sequence-count", "0");
  await page.waitForTimeout(3_000);
  await expect(reloadedBody).toHaveAttribute("data-seraph-sequence-count", "0");

  await page.goBack();
  await expect(page).toHaveURL(/\/canon\/dreams/);
  await page.goForward();
  await expect(page).toHaveURL(/\/$/);
  const forwardedBody = page.locator("[data-body-renderer]").first();
  await expect(page.locator("[data-dream-witness]")).toHaveCount(0);
  await expect(forwardedBody).toHaveAttribute("data-seraph-sequence-count", "0");
});

test("reduced motion switches to the real Seraph mask for one readable hold", async ({ page }) => {
  test.setTimeout(25_000);
  const dream = archiveEntry();
  seedDream(dream);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await enterArchiveReplay(page);

  const body = page.locator('svg[data-body-renderer="svg"]');
  await expect(body).toHaveAttribute("data-seraph", "converged");
  await expect(body).toHaveAttribute("data-seraph-timing", "0/6000/0");
  await expect(body).toHaveAttribute("data-seraph-sequence-count", "1");
  await expect(body.locator('[data-seraph-mask="true"]')).toBeVisible();
  await expect(body.locator("[data-organ]")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "recorded Dream" })).toContainText(ARCHIVE_NARRATIVE);
  await expect(body).toHaveAttribute("data-seraph", "five", { timeout: 7_000 });
  await expect(body).toHaveAttribute("data-completed-id", `converge:replay:${dream.id}:${dream.created_at}`);
  await expect(body).toHaveAttribute("data-completion-count", "1");
});

test("runtime WebGL loss preserves the same replay witness and completes once through SVG", async ({ page }) => {
  test.setTimeout(25_000);
  const dream = archiveEntry();
  seedDream(dream);
  await enterArchiveReplay(page);

  const canvas = page.locator('canvas[data-body-renderer="webgl"]');
  await expect(canvas).toHaveAttribute("data-seraph-phase", "gather", { timeout: 6_000 });
  const lost = await canvas.evaluate((node: HTMLCanvasElement) => {
    const extension = node.getContext("webgl2")?.getExtension("WEBGL_lose_context");
    if (extension === null || extension === undefined) return false;
    extension.loseContext();
    return true;
  });
  expect(lost).toBe(true);

  const body = page.locator('svg[data-body-renderer="svg"]');
  await expect(body).toHaveAttribute("data-seraph", "converged");
  await expect(body).toHaveAttribute("data-seraph-sequence-count", "1");
  await expect(body.locator('[data-seraph-mask="true"]')).toBeVisible();
  await expect(page.getByRole("region", { name: "recorded Dream" })).toContainText(ARCHIVE_NARRATIVE);
  await expect(body).toHaveAttribute("data-seraph", "five", { timeout: 7_000 });
  await expect(body).toHaveAttribute("data-completion-count", "1");
  await expect(page.locator('canvas[data-body-renderer="webgl"]')).toHaveCount(0);
});
