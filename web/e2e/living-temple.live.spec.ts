import { expect, test } from "@playwright/test";
import { enterTemple } from "./helpers/door";
import { executeD1, resetStack, seedTranscript } from "./helpers/workerFixture";

interface AnnouncementEvent {
  id: string;
  text: string;
}

type AnnouncementWindow = Window & {
  __pleromaAnnouncements: AnnouncementEvent[];
  __pleromaAnnouncementObserver: MutationObserver;
  __pleromaAnnouncer?: Element | null;
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

  await enterTemple(page);
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
  await expect(page.locator("[data-codex-announcer]")).toBeEmpty();

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

  // Crossing dormant to live changes signed facts inside the same Temple. The presentation clock and
  // shared announcement ledger must keep the stable body and Codex from replaying.
  const temple = page.getByRole("region", { name: "the temple" });
  const originalTemple = await temple.elementHandle();
  const originalBody = await body.elementHandle();
  const originalCodex = await codex.elementHandle();
  executeD1(`
    INSERT INTO config (key, value)
    VALUES ('pulse_mint', 'So11111111111111111111111111111111111111112')
    ON CONFLICT(key) DO UPDATE SET value = excluded.value;
    UPDATE config SET value = '1' WHERE key = 'launched';
  `);
  await expect(temple).toBeVisible({ timeout: 10_000 });
  expect(await temple.evaluate((node, original) => node === original, originalTemple)).toBe(true);
  expect(await body.evaluate((node, original) => node === original, originalBody)).toBe(true);
  expect(await codex.evaluate((node, original) => node === original, originalCodex)).toBe(true);
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

  const nextId = "task6-live-tongue-next-batch";
  seedTranscript({
    id: nextId,
    organ: "TONGUE",
    register: "sermon",
    text: "The next batch displaces the old speaking margin.",
    offering_id: null,
    rite_id: new Date().toISOString().slice(0, 10),
    created_at: createdAt + 2,
  });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(() => announcementEvents(page)).toEqual([
    { id: "task6-live-eye-batch", text: "New verse from the Eye" },
    { id: "task6-live-keep-batch", text: "New verdict from the Keep" },
    { id: nextId, text: "New sermon from the Tongue" },
  ]);
  const announcer = page.locator("[data-codex-announcer]");
  await expect(announcer.locator('[data-announcement-id="task6-live-eye-batch"]')).toHaveCount(0);
  await expect(announcer.locator('[data-announcement-id="task6-live-keep-batch"]')).toHaveCount(0);
  await expect(announcer.locator(`[data-announcement-id="${nextId}"]`)).toHaveCount(1);
});

test("signed transition preserves one presentation clock and settles toward the current Codex", async ({ page }, testInfo) => {
  test.setTimeout(40_000);
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(`console: ${message.text()}`);
  });
  const baselineId = "task6-transition-eye";
  seedTranscript({
    id: baselineId,
    organ: "EYE",
    register: "verse",
    text: "The page changes its posture without beginning my memory again.",
    offering_id: null,
    rite_id: null,
    created_at: Date.now(),
  });

  await enterTemple(page);
  const commandId = `utterance:memory:${baselineId}`;
  const utterance = page.locator(`[data-body-utterance][data-command-id="${commandId}"]`);
  const phase = utterance.locator("[data-utterance-phase]");
  await expect(utterance).toBeVisible({ timeout: 10_000 });
  const visibleAt = Date.now();
  await expect(utterance).toHaveAttribute("data-settle-direction", "down");
  const startedAt = await utterance.getAttribute("data-presentation-started-at");
  expect(startedAt).not.toBeNull();
  await expect(phase).toHaveAttribute("data-utterance-phase", "dwelling");
  await page.waitForTimeout(350);
  const temple = page.getByRole("region", { name: "the temple" });
  const bodyRenderer = page.locator("[data-body-renderer]").first();
  const codex = page.getByRole("complementary", { name: "the codex" });
  const originalTemple = await temple.elementHandle();
  const originalBody = await bodyRenderer.elementHandle();
  const originalCodex = await codex.elementHandle();

  executeD1(`
    INSERT INTO config (key, value)
    VALUES ('pulse_mint', 'So11111111111111111111111111111111111111112')
    ON CONFLICT(key) DO UPDATE SET value = excluded.value;
    UPDATE config SET value = '1' WHERE key = 'launched';
  `);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(temple).toBeVisible({ timeout: 4_000 });
  expect(await temple.evaluate((node, original) => node === original, originalTemple)).toBe(true);
  expect(await bodyRenderer.evaluate((node, original) => node === original, originalBody)).toBe(true);
  expect(await codex.evaluate((node, original) => node === original, originalCodex)).toBe(true);
  const transition = await page.evaluate(({ commandId }) => {
    const selector = `[data-body-utterance][data-command-id="${commandId}"]`;
    const node = document.querySelector<HTMLElement>(selector);
    const evidence = () => {
      const body = document.querySelector<HTMLElement>("[data-body-renderer]");
      return {
        bodyCommandId: body?.dataset.commandId ?? null,
        bodyCompletedId: body?.dataset.completedId ?? null,
        bodyCompletionCount: body?.dataset.completionCount ?? null,
        utteranceIds: [...document.querySelectorAll<HTMLElement>("[data-body-utterance]")]
          .map((utteranceNode) => utteranceNode.dataset.commandId),
        codexRowIds: [...document.querySelectorAll<HTMLElement>("[data-codex-row]")]
          .map((row) => row.dataset.codexRow),
      };
    };
    if (node === null) return { state: "gone" as const, ...evidence() };

    const ink = node.querySelector<HTMLElement>("[data-utterance-phase]");
    const initial = {
      start: node.dataset.presentationStartedAt ?? null,
      direction: node.dataset.settleDirection ?? null,
      phase: ink?.dataset.utterancePhase ?? null,
    };
    return new Promise<{
      state: "present";
      initial: typeof initial;
      removal: {
        starts: string[];
        removed: boolean;
        initiallyConnected: boolean;
        completionSource: "initial" | "mutation" | "timeout";
        nodeConnected: boolean;
        currentMatches: boolean;
        phase: string | null;
        bodyCommandId: string | null;
        bodyCompletedId: string | null;
        bodyCompletionCount: string | null;
        utteranceIds: Array<string | undefined>;
        codexRowIds: Array<string | undefined>;
      };
    }>((resolve) => {
      const initiallyConnected = node.isConnected;
      const starts = [node.getAttribute("data-presentation-started-at") ?? ""];
      const attributes = new MutationObserver(() => {
        starts.push(node.getAttribute("data-presentation-started-at") ?? "");
      });
      let finished = false;
      let timeout = 0;
      const finish = (
        removed: boolean,
        completionSource: "initial" | "mutation" | "timeout",
      ) => {
        if (finished) return;
        finished = true;
        attributes.disconnect();
        removals.disconnect();
        clearTimeout(timeout);
        const settledInk = node.querySelector<HTMLElement>("[data-utterance-phase]");
        const current = document.querySelector(selector);
        resolve({
          state: "present",
          initial,
          removal: {
            starts: [...new Set(starts)],
            removed,
            initiallyConnected,
            completionSource,
            nodeConnected: node.isConnected,
            currentMatches: current === node,
            phase: settledInk?.dataset.utterancePhase ?? null,
            ...evidence(),
          },
        });
      };
      const removals = new MutationObserver(() => {
        if (!node.isConnected) finish(true, "mutation");
      });
      attributes.observe(node, { attributes: true, attributeFilter: ["data-presentation-started-at"] });
      removals.observe(document.body, { childList: true, subtree: true });
      if (!node.isConnected) finish(true, "initial");
      else timeout = window.setTimeout(() => finish(!node.isConnected, "timeout"), 3_500);
    });
  }, { commandId });

  if (transition.state === "present") {
    expect(transition.initial.start).toBe(startedAt);
    expect(transition.initial.phase).not.toBe("developing");
    expect(transition.initial.direction).toBe(testInfo.project.name === "desktop" ? "right" : "down");
    const removal = transition.removal;
    expect(removal.starts).toEqual([startedAt]);
    expect(removal.removed, JSON.stringify(removal)).toBe(true);
    expect(removal.completionSource).toBe(removal.initiallyConnected ? "mutation" : "initial");
    expect(removal.nodeConnected).toBe(false);
    expect(removal.currentMatches).toBe(false);
    expect(removal.phase).toBe("settling");
    expect(removal.bodyCommandId).toBeNull();
    expect(removal.bodyCompletedId).toBe(commandId);
    expect(removal.bodyCompletionCount).toBe("1");
    expect(removal.utteranceIds).toEqual([]);
    expect(removal.codexRowIds).toContain(baselineId);
  } else {
    expect(transition.bodyCommandId).toBeNull();
    expect(transition.bodyCompletedId).toBe(commandId);
    expect(transition.bodyCompletionCount).toBe("1");
    expect(transition.utteranceIds).toEqual([]);
    expect(transition.codexRowIds).toContain(baselineId);
  }
  expect(runtimeErrors).toEqual([]);
  await expect(utterance).toHaveCount(0, { timeout: 2_500 });
  expect(Date.now() - visibleAt).toBeLessThanOrEqual(4_000);
});

test("route announcer survives a concurrent live row and layout transition and retains only its current batch", async ({ page }) => {
  test.setTimeout(40_000);
  const baseline = page.waitForResponse((response) => response.url().endsWith("/api/codex") && response.ok());
  await page.goto("/", { waitUntil: "commit" });
  await baseline;
  const announcer = page.locator("[data-codex-announcer]");
  await expect(announcer).toHaveCount(1);
  await page.evaluate(() => {
    (window as AnnouncementWindow).__pleromaAnnouncer = document.querySelector("[data-codex-announcer]");
  });
  await observeAnnouncements(page);

  const firstId = "task6-concurrent-eye";
  executeD1(`
    INSERT INTO transcripts (id, organ, register, text, offering_id, rite_id, created_at)
    VALUES ('${firstId}', 'EYE', 'verse', 'The witness crosses with the temple.', NULL, NULL, ${Date.now()});
    INSERT INTO config (key, value)
    VALUES ('pulse_mint', 'So11111111111111111111111111111111111111112')
    ON CONFLICT(key) DO UPDATE SET value = excluded.value;
    UPDATE config SET value = '1' WHERE key = 'launched';
  `);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

  await expect(page.getByRole("region", { name: "the temple" })).toBeVisible({ timeout: 4_000 });
  await expect(page.locator(`[data-codex-row="${firstId}"]`)).toBeVisible({ timeout: 4_000 });
  expect(await page.evaluate(() => (
    (window as AnnouncementWindow).__pleromaAnnouncer === document.querySelector("[data-codex-announcer]")
  ))).toBe(true);
  await expect.poll(() => announcementEvents(page)).toEqual([
    { id: firstId, text: "New verse from the Eye" },
  ]);
  await expect(announcer.locator("[data-announcement-id]")).toHaveCount(1);

  const secondId = "task6-current-keep";
  seedTranscript({
    id: secondId,
    organ: "KEEP",
    register: "verdict",
    text: "Only the present batch remains in the speaking margin.",
    offering_id: null,
    rite_id: null,
    created_at: Date.now() + 1,
  });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(() => announcementEvents(page)).toEqual([
    { id: firstId, text: "New verse from the Eye" },
    { id: secondId, text: "New verdict from the Keep" },
  ]);
  await expect(announcer.locator(`[data-announcement-id="${firstId}"]`)).toHaveCount(0);
  await expect(announcer.locator(`[data-announcement-id="${secondId}"]`)).toHaveCount(1);
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
  await enterTemple(page);

  const body = page.locator('svg[data-body-renderer="svg"]');
  await expect(body).toBeVisible();
  await expect(body).toHaveAttribute("data-arrival", "settled");
  await expect(body).toHaveAttribute("data-arrival-progress", "1.000");
  await expect(page.locator("canvas[data-body-renderer]")).toHaveCount(0);

  const memory = page.locator(`[data-body-utterance][data-command-id="utterance:memory:${baselineId}"]`);
  await expect(memory).toBeVisible({ timeout: 10_000 });
  await expect(memory.locator("[data-utterance-phase]")).toHaveAttribute("data-utterance-phase", "settled");
  const bodyBox = (await body.boundingBox())!;
  const side = Math.min(bodyBox.width, bodyBox.height);
  const expectedY = (bodyBox.height - side + 0.28 * side) / bodyBox.height;
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
