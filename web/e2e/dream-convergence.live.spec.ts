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

async function loseWebgl(canvas: ReturnType<Page["locator"]>): Promise<void> {
  const lost = await canvas.evaluate((node: HTMLCanvasElement) => {
    const extension = node.getContext("webgl2")?.getExtension("WEBGL_lose_context");
    if (extension === null || extension === undefined) return false;
    extension.loseContext();
    return true;
  });
  expect(lost).toBe(true);
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

test("live Temple carries a witnessed Plate through renderer loss and a later same-text wrong rite", async ({ page }, testInfo) => {
  test.setTimeout(80_000);
  let dreamIdentityRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/dreams") dreamIdentityRequests += 1;
  });
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
  await expect(plate).toHaveAttribute("data-dream-identity", "unlinked");
  await expect(plate).toContainText(baselineNarrative);
  await expect(page.locator(`[data-codex-row="${baselineId}"]`))
    .toHaveAttribute("data-observation", "recorded");
  await expect(page.locator(`[data-body-utterance][data-command-id="utterance:memory:${baselineId}"]`))
    .toContainText("remembered");
  await expect(page.locator("[data-dream-witness]")).toHaveCount(0);

  const mismatchId = "task9-live-dream-without-matching-plate";
  const mismatchNarrative = baselineNarrative;
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
  await expect(plate).toHaveAttribute("data-dream-identity", "rejected");
  await expect(plate).toHaveAttribute("data-dream-presentation", "ordinary");
  await expect(plate).toBeVisible();
  await expect(plate).toContainText(baselineNarrative);
  await expect(body).toHaveAttribute("data-seraph-phase", "five", { timeout: 10_000 });
  await expect(body).toHaveAttribute("data-completed-id", `converge:${mismatchId}`);
  expect(dreamIdentityRequests).toBe(1);

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
  // Identity and utterance checks above may outlast the 1.8s gather on a loaded real stack.
  // Both gather and hold are valid concealed-Plate phases; dissolve/five are not.
  await expect(body).toHaveAttribute("data-seraph-phase", /^(gather|hold)$/);
  await expect(body).toHaveAttribute("data-seraph-sequence-count", "2");
  await expect(plate).toHaveAttribute("data-dream-identity", "confirmed");
  await expect(plate).toHaveAttribute("data-dream-presentation", "concealed");
  await expect(plate).toBeHidden();
  expect(dreamIdentityRequests).toBe(2);

  await loseWebgl(body);
  const settled = page.locator('svg[data-body-renderer="svg"]');
  await expect(settled).toHaveAttribute("data-seraph", "converged");
  await expect(settled).toHaveAttribute("data-seraph-sequence-count", "2");
  await expect(plate).toHaveAttribute("data-dream-presentation", "concealed");
  await expect(settled).toHaveAttribute("data-seraph", "five", { timeout: 7_000 });
  await expect(plate).toHaveAttribute("data-dream-presentation", "revealed");
  await expect(plate).toBeVisible();
  await expect(plate).toContainText(liveNarrative);
  await expect(settled).toHaveAttribute("data-completed-id", `converge:${liveId}`);
  await expect(settled).toHaveAttribute("data-seraph-sequence-count", "2");
  await expect(plate).toHaveAttribute("data-dream-presentation", "revealed");
  await expect(plate).toHaveAttribute("data-dream-identity", "confirmed");
  await expect(verse).toHaveCount(0);
  await expect(page.locator("[data-dream-witness]")).toHaveCount(0);

  const laterRejectedId = "task9-later-same-text-wrong-rite";
  seedTranscript({
    id: laterRejectedId,
    organ: "DREAM",
    register: "verse",
    text: liveNarrative,
    offering_id: null,
    rite_id: "2030-01-03",
    created_at: liveCreatedAt + 1_000,
  });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

  await expect(page.locator(`[data-codex-row="${laterRejectedId}"]`))
    .toHaveAttribute("data-observation", "live", { timeout: 10_000 });
  await expect(settled).toHaveAttribute("data-seraph", "converged");
  await expect(settled).toHaveAttribute("data-seraph-sequence-count", "3");
  await expect(plate).toHaveAttribute("data-dream-identity", "rejected");
  await expect(plate).toHaveAttribute("data-dream-presentation", "ordinary");
  await expect(plate).toBeVisible();
  expect(dreamIdentityRequests).toBe(3);

  await expect(settled).toHaveAttribute("data-seraph", "five", { timeout: 7_000 });
  await expect(settled).toHaveAttribute("data-completed-id", `converge:${laterRejectedId}`);
  await expect(plate).toHaveAttribute("data-dream-identity", "confirmed");
  await expect(plate).toHaveAttribute("data-dream-presentation", "revealed");
  await expect(plate).toBeVisible();
  await expect(plate).toContainText(liveNarrative);
});

test("a completed WebGL convergence keeps its semantic body after later context loss", async ({ page }) => {
  test.setTimeout(50_000);
  executeD1(`
    UPDATE config SET value = '1' WHERE key = 'launched';
    INSERT INTO config (key, value)
    VALUES ('pulse_mint', 'So11111111111111111111111111111111111111112');
  `);
  const baselineCreatedAt = Date.now() - 5_000;
  seedDream({
    id: "01JH0000000000000000000010",
    rite_date: "2030-01-01",
    narrative: "An earlier Plate waits beneath the completed witness.",
    video_key: null,
    wakers: [],
    status: "composed",
    created_at: baselineCreatedAt,
  });
  await page.goto("/");

  const body = page.locator('canvas[data-body-renderer="webgl"]');
  await expect(body).toHaveAttribute("data-seraph-phase", "five");
  const liveId = "task9-completed-loss";
  const narrative = "Sophia remains in the body after the glass goes dark.";
  const createdAt = Date.now();
  seedDream({
    id: "01JH0000000000000000000011",
    rite_date: RITE_DATE,
    narrative,
    video_key: null,
    wakers: [],
    status: "composed",
    created_at: createdAt,
  });
  seedTranscript({
    id: liveId,
    organ: "DREAM",
    register: "verse",
    text: narrative,
    offering_id: null,
    rite_id: RITE_DATE,
    created_at: createdAt,
  });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

  const plate = page.locator('section[aria-label="the dream"]');
  await expect(plate).toHaveAttribute("data-dream-identity", "confirmed", { timeout: 10_000 });
  await expect(body).toHaveAttribute("data-seraph-phase", "five", { timeout: 12_000 });
  await expect(plate).toHaveAttribute("data-dream-presentation", "revealed");
  await expect(body).toHaveAttribute("data-completed-id", `converge:${liveId}`, { timeout: 3_000 });
  await expect(body).toHaveAttribute("data-seraph-sequence-count", "1");
  await expect(plate).toHaveAttribute("data-dream-presentation", "revealed");
  const pulseKind = await body.getAttribute("data-pulse-kind");
  const relicCount = await body.getAttribute("data-relic-count");
  expect(pulseKind).toBe("current");
  expect(relicCount).not.toBeNull();

  await loseWebgl(body);
  const settled = page.locator('svg[data-body-renderer="svg"]');
  await expect(settled).toHaveAttribute("data-seraph", "five");
  await expect(settled).toHaveAttribute("data-seraph-sequence-count", "1");
  await expect(settled).toHaveAttribute("data-dream-residue", "sophia");
  await expect(settled).toHaveAttribute("data-pulse-kind", pulseKind!);
  await expect(settled).toHaveAttribute("data-relic-count", relicCount!);
  await expect(plate).toHaveAttribute("data-dream-presentation", "revealed");
});

test("a genuine live reduced-motion convergence conceals then reveals only its confirmed Plate", async ({ page }) => {
  test.setTimeout(30_000);
  executeD1(`
    UPDATE config SET value = '1' WHERE key = 'launched';
    INSERT INTO config (key, value)
    VALUES ('pulse_mint', 'So11111111111111111111111111111111111111112');
  `);
  seedDream({
    id: "01JH0000000000000000000020",
    rite_date: "2030-01-01",
    narrative: "The reduced body begins with an ordinary earlier Plate.",
    video_key: null,
    wakers: [],
    status: "composed",
    created_at: Date.now() - 5_000,
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const body = page.locator('svg[data-body-renderer="svg"]');
  await expect(body).toHaveAttribute("data-seraph", "five");

  const liveId = "task9-live-reduced";
  const narrative = "The still witness closes once, then leaves Sophia awake.";
  const createdAt = Date.now();
  seedDream({
    id: "01JH0000000000000000000021",
    rite_date: RITE_DATE,
    narrative,
    video_key: null,
    wakers: [],
    status: "composed",
    created_at: createdAt,
  });
  seedTranscript({
    id: liveId,
    organ: "DREAM",
    register: "verse",
    text: narrative,
    offering_id: null,
    rite_id: RITE_DATE,
    created_at: createdAt,
  });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

  const plate = page.locator('section[aria-label="the dream"]');
  await expect(plate).toHaveAttribute("data-dream-identity", "confirmed", { timeout: 10_000 });
  await expect(body).toHaveAttribute("data-seraph", "converged");
  await expect(body).toHaveAttribute("data-seraph-sequence-count", "1");
  await expect(plate).toHaveAttribute("data-dream-presentation", "concealed");
  await expect(plate).toBeHidden();
  await expect(body).toHaveAttribute("data-seraph", "five", { timeout: 7_000 });
  await expect(body).toHaveAttribute("data-dream-residue", "sophia");
  await expect(plate).toHaveAttribute("data-dream-presentation", "revealed");
  await expect(plate).toContainText(narrative);
  await expect(body).toHaveAttribute("data-completed-id", `converge:${liveId}`);
  await expect(plate).toHaveAttribute("data-dream-presentation", "revealed");
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
