import { createHash } from "node:crypto";
import { enterTemple } from "./helpers/door";
import { expect, test, type Page } from "@playwright/test";
import {
  executeD1,
  promoteSubmittedOffering,
  putRelicPng,
  readR2Object,
  resetStack,
  setAccretedAt,
} from "./helpers/workerFixture";

function wakeVisibleFeeds(page: Page): Promise<void> {
  return page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
}

async function holdKeyboardSeal(page: Page): Promise<void> {
  const seal = page.getByRole("button", { name: "hold the threshold seal" });
  await expect(seal).toBeVisible({ timeout: 10_000 });
  await seal.scrollIntoViewIfNeeded();
  await seal.focus();
  await page.keyboard.down("Enter");
  await page.waitForTimeout(140);
  await page.keyboard.up("Enter");
  await expect(page.locator("img[data-threshold-preview]")).toBeVisible();
}

async function observeAccretion(page: Page): Promise<void> {
  await page.evaluate(() => {
    const body = document.querySelector<HTMLElement>("[data-body-renderer]");
    if (body === null) throw new Error("body renderer is missing");
    const state = window as typeof window & {
      __task8Accretion?: { active: string[]; completed: string[]; revisions: string[] };
    };
    state.__task8Accretion = { active: [], completed: [], revisions: [] };
    const record = () => {
      const evidence = state.__task8Accretion!;
      const active = body.dataset.accretionActiveKey;
      const completed = body.dataset.completedId;
      const revision = body.dataset.relicRevision;
      if (active && evidence.active.at(-1) !== active) evidence.active.push(active);
      if (completed?.startsWith("accrete:") && evidence.completed.at(-1) !== completed) {
        evidence.completed.push(completed);
      }
      if (revision && evidence.revisions.at(-1) !== revision) evidence.revisions.push(revision);
    };
    record();
    new MutationObserver(record).observe(body, { attributes: true });
  });
}

test.beforeEach(() => {
  resetStack();
  executeD1("UPDATE config SET value = '1' WHERE key = 'launched';");
});

test("a submitted imprint enters the body only after its real public relic timestamp", async ({ page }) => {
  const imageRequests: string[] = [];
  const imageResponseDigests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/img/")) imageRequests.push(request.url());
  });
  page.on("response", async (response) => {
    if (!new URL(response.url()).pathname.startsWith("/api/img/") || !response.ok()) return;
    const bytes = await response.body();
    imageResponseDigests.push(createHash("sha256").update(bytes).digest("hex"));
  });

  await enterTemple(page);
  await expect(page.getByRole("region", { name: "the market" })).toBeVisible({ timeout: 10_000 });
  await observeAccretion(page);
  await holdKeyboardSeal(page);
  await page.getByRole("button", { name: "offer this imprint" }).click();

  const pending = page.locator('[data-receipt-stage="pending"]');
  await expect(pending).toContainText("awaiting the Eye", { timeout: 10_000 });
  const offeringId = await pending.getAttribute("data-offering-id");
  expect(offeringId).toBeTruthy();
  const submittedBytes = readR2Object(`quarantine/${offeringId!}`);
  const submittedDigest = createHash("sha256").update(submittedBytes).digest("hex");

  const now = Date.now();
  executeD1(`
    INSERT INTO transcripts (id, organ, register, text, offering_id, rite_id, created_at)
    VALUES (
      '01JZTASK8EYE00000000000000', 'EYE', 'verse',
      'The Eye receives the submitted imprint.', '${offeringId}', NULL, ${now}
    );
  `);
  await wakeVisibleFeeds(page);
  const receipt = page.locator(`[data-offering-id="${offeringId}"]`);
  await expect(receipt).toHaveAttribute("data-receipt-stage", "witnessed", { timeout: 10_000 });

  executeD1(`
    INSERT INTO transcripts (id, organ, register, text, offering_id, rite_id, created_at)
    VALUES (
      '01JZTASK8KEEP0000000000000', 'KEEP', 'verdict',
      'The Keep judges the witnessed imprint.', '${offeringId}', NULL, ${now + 1}
    );
  `);
  await wakeVisibleFeeds(page);
  await expect(receipt).toHaveAttribute("data-receipt-stage", "judged", { timeout: 10_000 });

  promoteSubmittedOffering(offeringId!);
  const relicId = `relic-${offeringId}`;
  executeD1(`
    INSERT INTO relics (id, offering_id, wallet, summary, rite_id, kept_at, genesis, accreted_at)
    VALUES ('${relicId}', '${offeringId}', NULL, 'the submitted threshold imprint', NULL, ${now + 2}, 0, NULL);
  `);
  await wakeVisibleFeeds(page);
  await expect(receipt).toHaveAttribute("data-receipt-stage", "kept", { timeout: 10_000 });
  await expect(receipt).toContainText("kept, awaiting accretion");
  await page.waitForTimeout(500);
  expect(imageRequests).toEqual([]);
  const reliquaryEntry = page.locator(`[data-reliquary-offering="${offeringId}"]`);
  await expect(reliquaryEntry).toHaveAttribute("data-relic-accreted", "false");
  await expect(page.locator("[data-body-renderer]")).toHaveAttribute("data-relic-count", "0");
  await expect(page.locator("[data-body-renderer]")).toHaveAttribute("data-relic-mask-nonzero", "0");

  const accretedAt = now + 3;
  setAccretedAt(relicId, accretedAt);
  await wakeVisibleFeeds(page);

  const accretionKey = `${offeringId}\u001f${accretedAt}`;
  await expect.poll(async () => page.evaluate(() => (
    (window as typeof window & { __task8Accretion?: { active: string[] } }).__task8Accretion?.active ?? []
  )), { timeout: 10_000 }).toContain(accretionKey);
  await expect(receipt).toHaveAttribute("data-receipt-stage", "accreted", { timeout: 10_000 });
  await expect(receipt).toContainText("carried into the body");
  await expect(reliquaryEntry).toHaveAttribute("data-relic-accreted", "true");
  await expect(reliquaryEntry.locator("img")).toBeVisible();
  const body = page.locator("[data-body-renderer]");
  await expect(body).toHaveAttribute("data-relic-count", "1", { timeout: 10_000 });
  await expect.poll(async () => Number(await body.getAttribute("data-relic-mask-nonzero")), {
    timeout: 10_000,
  }).toBeGreaterThan(0);
  await expect.poll(() => imageResponseDigests, { timeout: 10_000 }).toContain(submittedDigest);
  await expect.poll(() => page.evaluate(() => (
    (window as typeof window & { __task8Accretion?: { completed: string[] } })
      .__task8Accretion?.completed ?? []
  )), { timeout: 5_000 }).toEqual([`accrete:${relicId}:${accretedAt}`]);

  const afterFirst = await page.evaluate(() => (
    (window as typeof window & {
      __task8Accretion?: { active: string[]; completed: string[]; revisions: string[] };
    }).__task8Accretion!
  ));
  expect(afterFirst.active).toEqual([accretionKey]);
  expect(afterFirst.completed).toEqual([`accrete:${relicId}:${accretedAt}`]);
  const committedRevision = await body.getAttribute("data-relic-revision");
  expect(Number(committedRevision)).toBeGreaterThan(0);
  const imageRequestCount = imageRequests.length;

  await wakeVisibleFeeds(page);
  await page.waitForTimeout(1_500);
  expect(imageRequests).toHaveLength(imageRequestCount);
  expect(await body.getAttribute("data-relic-revision")).toBe(committedRevision);
  expect(await page.evaluate(() => (
    (window as typeof window & { __task8Accretion?: { completed: string[] } })
      .__task8Accretion?.completed ?? []
  ))).toEqual([`accrete:${relicId}:${accretedAt}`]);

  await page.addInitScript(() => {
    const state = window as typeof window & { __task8ReloadAccretions?: string[] };
    state.__task8ReloadAccretions = [];
    window.addEventListener("DOMContentLoaded", () => {
      const root = document.documentElement;
      const record = () => {
        for (const bodyNode of document.querySelectorAll<HTMLElement>("[data-body-renderer]")) {
          const commandId = bodyNode.dataset.commandId;
          if (commandId?.startsWith("accrete:") && !state.__task8ReloadAccretions!.includes(commandId)) {
            state.__task8ReloadAccretions!.push(commandId);
          }
        }
      };
      record();
      new MutationObserver(record).observe(root, { childList: true, subtree: true, attributes: true });
    }, { once: true });
  });
  await page.reload();
  const reloadedBody = page.locator("[data-body-renderer]");
  await expect(reloadedBody).toHaveAttribute("data-relic-count", "1", { timeout: 10_000 });
  await expect.poll(async () => Number(await reloadedBody.getAttribute("data-relic-mask-nonzero")), {
    timeout: 10_000,
  }).toBeGreaterThan(0);
  expect(await page.evaluate(() => (
    (window as typeof window & { __task8ReloadAccretions?: string[] }).__task8ReloadAccretions ?? []
  ))).toEqual([]);
  await expect(page.locator(`[data-offering-id="${offeringId}"]`))
    .toHaveAttribute("data-receipt-stage", "accreted");
});

test("context loss replays one active accretion in the settled body", async ({ page }) => {
  const baselineRelics = page.waitForResponse((response) => (
    new URL(response.url()).pathname === "/api/relics" && response.ok()
  ));
  await enterTemple(page);
  await baselineRelics;
  const canvas = page.locator('canvas[data-body-renderer="webgl"]');
  await expect(canvas).toBeVisible({ timeout: 10_000 });

  await page.evaluate(() => {
    const state = window as typeof window & { __task8FallbackCompletions?: string[] };
    state.__task8FallbackCompletions = [];
    const record = () => {
      for (const body of document.querySelectorAll<HTMLElement>("[data-body-renderer]")) {
        const completed = body.dataset.completedId;
        if (completed?.startsWith("accrete:") && !state.__task8FallbackCompletions!.includes(completed)) {
          state.__task8FallbackCompletions!.push(completed);
        }
      }
    };
    new MutationObserver(record).observe(document.body, { childList: true, subtree: true, attributes: true });
  });

  const offeringId = "01JZ0000000000000000000001";
  const relicId = "task8-context-relic";
  const accretedAt = Date.now();
  putRelicPng(offeringId);
  executeD1(`
    INSERT INTO relics (id, offering_id, wallet, summary, rite_id, kept_at, genesis, accreted_at)
    VALUES ('${relicId}', '${offeringId}', NULL, 'context-held relic', NULL, ${accretedAt - 1}, 0, NULL);
  `);
  await wakeVisibleFeeds(page);
  await expect(page.locator(`[data-reliquary-offering="${offeringId}"]`))
    .toHaveAttribute("data-relic-accreted", "false", { timeout: 10_000 });
  setAccretedAt(relicId, accretedAt);
  await wakeVisibleFeeds(page);

  const key = `${offeringId}\u001f${accretedAt}`;
  await expect(canvas).toHaveAttribute("data-accretion-active-key", key, { timeout: 10_000 });
  expect(await canvas.evaluate((node: HTMLCanvasElement) => {
    const extension = node.getContext("webgl2")?.getExtension("WEBGL_lose_context");
    if (extension === null || extension === undefined) return false;
    extension.loseContext();
    return true;
  })).toBe(true);

  const settled = page.locator('svg[data-body-renderer="svg"]');
  await expect(settled).toBeVisible({ timeout: 10_000 });
  await expect(settled).toHaveAttribute("data-relic-count", "1", { timeout: 10_000 });
  await expect.poll(async () => Number(await settled.getAttribute("data-relic-mask-nonzero")), {
    timeout: 10_000,
  }).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => (
    (window as typeof window & { __task8FallbackCompletions?: string[] })
      .__task8FallbackCompletions ?? []
  )), { timeout: 5_000 }).toEqual([`accrete:${relicId}:${accretedAt}`]);
  await page.waitForTimeout(1_300);
  expect(await page.evaluate(() => (
    (window as typeof window & { __task8FallbackCompletions?: string[] })
      .__task8FallbackCompletions ?? []
  ))).toEqual([`accrete:${relicId}:${accretedAt}`]);
});

test("reduced motion commits confirmed ink without threshold travel", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const baselineRelics = page.waitForResponse((response) => (
    new URL(response.url()).pathname === "/api/relics" && response.ok()
  ));
  await enterTemple(page);
  await baselineRelics;
  const settled = page.locator('svg[data-body-renderer="svg"]');
  await expect(settled).toBeVisible({ timeout: 10_000 });

  const offeringId = "01JZ0000000000000000000002";
  const relicId = "task8-reduced-relic";
  const accretedAt = Date.now();
  putRelicPng(offeringId);
  executeD1(`
    INSERT INTO relics (id, offering_id, wallet, summary, rite_id, kept_at, genesis, accreted_at)
    VALUES ('${relicId}', '${offeringId}', NULL, 'still accretion', NULL, ${accretedAt - 1}, 0, NULL);
  `);
  await wakeVisibleFeeds(page);
  await expect(page.locator(`[data-reliquary-offering="${offeringId}"]`))
    .toHaveAttribute("data-relic-accreted", "false", { timeout: 10_000 });
  setAccretedAt(relicId, accretedAt);
  await wakeVisibleFeeds(page);

  await expect(settled).toHaveAttribute("data-relic-count", "1", { timeout: 10_000 });
  await expect.poll(async () => Number(await settled.getAttribute("data-relic-mask-nonzero")), {
    timeout: 10_000,
  }).toBeGreaterThan(0);
  await expect(page.locator("[data-relic-travel]")).toHaveCount(0);
  await expect(settled).not.toHaveAttribute("data-accretion-active-key", /.+/);
  await expect(settled).toHaveAttribute("data-completed-id", `accrete:${relicId}:${accretedAt}`);
});
