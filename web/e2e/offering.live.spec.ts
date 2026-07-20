import { createHash } from "node:crypto";
import { enterTemple } from "./helpers/door";
import { expect, test } from "@playwright/test";
import {
  executeD1,
  putRelicPng,
  readR2Object,
  resetStack,
} from "./helpers/workerFixture";

test.beforeEach(() => {
  resetStack();
  executeD1("UPDATE config SET value = '1' WHERE key = 'launched';");
});

test("offers the exact real preview PNG and creates only a pending receipt", async ({ page }) => {
  await enterTemple(page);
  await expect(page.getByRole("region", { name: "the market" })).toBeVisible({ timeout: 10_000 });

  const seal = page.getByRole("button", { name: "hold the threshold seal" });
  await expect(seal).toBeVisible({ timeout: 5_000 });
  const originalSeal = await seal.elementHandle();
  expect(originalSeal).not.toBeNull();
  await seal.scrollIntoViewIfNeeded();
  const sealBox = (await seal.boundingBox())!;
  expect(sealBox.width).toBeGreaterThanOrEqual(44);
  expect(sealBox.height).toBeGreaterThanOrEqual(44);

  await page.evaluate(() => {
    const body = document.querySelector<HTMLElement>("[data-body-renderer]");
    if (body === null) throw new Error("body renderer is missing");
    (window as typeof window & { __accretionCommands?: string[] }).__accretionCommands = [];
    const observer = new MutationObserver(() => {
      const id = body.dataset.commandId;
      if (id?.startsWith("accrete:")) {
        (window as typeof window & { __accretionCommands?: string[] }).__accretionCommands?.push(id);
      }
    });
    observer.observe(body, { attributes: true, attributeFilter: ["data-command-id"] });
  });

  await page.mouse.move(sealBox.x + sealBox.width / 2, sealBox.y + sealBox.height / 2);
  await page.mouse.down();
  await expect.poll(() => seal.evaluate((node) => (node as HTMLButtonElement).hasPointerCapture(1))).toBe(true);
  await page.waitForTimeout(180);
  await page.mouse.move(sealBox.x + sealBox.width * 0.68, sealBox.y + sealBox.height * 0.38, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => originalSeal!.evaluate(node => (
    !node.isConnected || !(node as HTMLButtonElement).hasPointerCapture(1)
  ))).toBe(true);

  const preview = page.locator("img[data-threshold-preview]");
  await expect(preview).toBeVisible();
  const previewEvidence = await preview.evaluate(async (node) => {
    const response = await fetch((node as HTMLImageElement).src);
    const blob = await response.blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("preview canvas unavailable");
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const alpha = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    return {
      type: blob.type,
      size: blob.size,
      width: canvas.width,
      height: canvas.height,
      nonblank: alpha.some((value, index) => index % 4 === 3 && value !== 0),
      digest,
    };
  });
  expect(previewEvidence).toMatchObject({
    type: "image/png",
    width: 512,
    height: 512,
    nonblank: true,
  });
  expect(previewEvidence.size).toBeLessThanOrEqual(512 * 1024);

  await page.getByRole("button", { name: "offer this imprint" }).click();
  const pending = page.locator('[data-receipt-stage="pending"]');
  await expect(pending).toContainText("awaiting the Eye", { timeout: 10_000 });
  const offeringId = await pending.getAttribute("data-offering-id");
  expect(offeringId).toBeTruthy();

  const quarantined = readR2Object(`quarantine/${offeringId!}`);
  expect(createHash("sha256").update(quarantined).digest("hex")).toBe(previewEvidence.digest);
  await page.waitForTimeout(1_500);
  expect(await page.evaluate(() => (
    (window as typeof window & { __accretionCommands?: string[] }).__accretionCommands ?? []
  ))).toEqual([]);
  await expect(page.locator(`[data-relic-offering="${offeringId}"]`)).toHaveCount(0);
  await pending.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `e2e/__shots__/threshold-receipt-${test.info().project.name}.png` });
});

test("keyboard hold creates a preview and letting it fade releases the threshold", async ({ page }) => {
  executeD1("UPDATE config SET value = '0' WHERE key = 'launched';");
  await enterTemple(page);
  await expect(page.getByRole("region", { name: "the temple" })).toBeVisible({ timeout: 10_000 });
  const seal = page.getByRole("button", { name: "hold the threshold seal" });
  await expect(seal).toBeVisible({ timeout: 5_000 });
  await seal.scrollIntoViewIfNeeded();
  await seal.focus();
  await page.keyboard.down("Space");
  await page.waitForTimeout(140);
  await page.keyboard.up("Space");
  const preview = page.locator("img[data-threshold-preview]");
  await expect(preview).toBeVisible();
  const previewUrl = await preview.getAttribute("src");
  expect(previewUrl).toMatch(/^blob:/);
  await page.getByRole("button", { name: "let the imprint fade" }).click();
  await expect(preview).toHaveCount(0);
  expect(await page.evaluate(async (url) => {
    try {
      await fetch(url!);
      return true;
    } catch {
      return false;
    }
  }, previewUrl)).toBe(false);
  await expect(seal).toBeVisible();
});

test("the short mobile threshold remains one usable, scrollable rite through submission", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-390", "short threshold geometry is a mobile concern");
  await page.setViewportSize({ width: 390, height: 667 });
  await enterTemple(page);

  const threshold = page.locator("[data-threshold-offering]");
  const originalThreshold = await threshold.elementHandle();
  const seal = page.getByRole("button", { name: "hold the threshold seal" });
  await seal.focus();
  await page.keyboard.down("Enter");
  await page.waitForTimeout(140);
  await page.keyboard.up("Enter");

  await expect(threshold).toHaveAttribute("data-threshold-phase", "preview");
  expect(await threshold.evaluate((node, original) => node === original, originalThreshold)).toBe(true);
  expect(await threshold.evaluate(node => ({
    position: getComputedStyle(node).position,
    overflowY: getComputedStyle(node).overflowY,
    top: node.getBoundingClientRect().top,
    height: node.getBoundingClientRect().height,
  }))).toEqual({ position: "fixed", overflowY: "auto", top: 0, height: 667 });

  const previewParts = [
    page.locator("img[data-threshold-preview]"),
    page.locator("[data-threshold-actions]"),
    page.locator("[data-threshold-terms]"),
    page.getByRole("button", { name: "connect a wallet" }),
  ];
  for (const part of previewParts) {
    await part.scrollIntoViewIfNeeded();
    const box = (await part.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(667);
  }
  for (const action of await threshold.locator("button").all()) {
    const box = (await action.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }

  const wallet = page.getByRole("button", { name: "connect a wallet" });
  await expect(wallet).toHaveAttribute("aria-expanded", "false");
  const chooserId = await wallet.getAttribute("aria-controls");
  expect(chooserId).toBeTruthy();
  await wallet.click();
  await expect(wallet).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(`[id="${chooserId}"]`)).toBeVisible();
  await expect(page.getByRole("status", { name: "" }).filter({ hasText: "no wallet found" })).toBeVisible();

  await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>("[data-threshold-offering]")!;
    const target = window as typeof window & {
      __thresholdSubmitting?: { position: string; overflowY: string; height: number; scrollHeight: number };
    };
    new MutationObserver(() => {
      if (root.dataset.thresholdPhase !== "submitting") return;
      target.__thresholdSubmitting = {
        position: getComputedStyle(root).position,
        overflowY: getComputedStyle(root).overflowY,
        height: root.getBoundingClientRect().height,
        scrollHeight: root.scrollHeight,
      };
    }).observe(root, { attributes: true, attributeFilter: ["data-threshold-phase"] });
  });
  await page.getByRole("button", { name: "offer this imprint" }).click();
  await expect(page.locator('[data-receipt-stage="pending"]'))
    .toContainText("awaiting the Eye", { timeout: 10_000 });
  const submitting = await page.evaluate(() => (
    window as typeof window & {
      __thresholdSubmitting?: { position: string; overflowY: string; height: number; scrollHeight: number };
    }
  ).__thresholdSubmitting);
  expect(submitting).toBeDefined();
  expect(submitting).toMatchObject({ position: "fixed", overflowY: "auto", height: 667 });
  expect(submitting!.scrollHeight).toBeGreaterThanOrEqual(submitting!.height);
  expect(await threshold.evaluate((node, original) => node === original, originalThreshold)).toBe(true);
});

test("a real finger tap presses the seal into a preview and offers it (mobile touch)", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-390", "touch seal + offer is a mobile concern");
  await enterTemple(page);
  await expect(page.getByRole("region", { name: "the market" })).toBeVisible({ timeout: 10_000 });

  const seal = page.getByRole("button", { name: "hold the threshold seal" });
  await expect(seal).toBeVisible({ timeout: 5_000 });
  await seal.scrollIntoViewIfNeeded();
  const sealBox = (await seal.boundingBox())!;
  const threshold = page.locator("[data-threshold-offering]");

  // A real finger tap — not keyboard, not a mouse .click(). On WebKit the seal's touch pointerup
  // retargets off the button (see ThresholdOffering: setPointerCapture is skipped for touch and the
  // gesture completes from window listeners); the press must still finish into a lasting preview
  // rather than collapsing straight back to idle.
  await page.touchscreen.tap(sealBox.x + sealBox.width / 2, sealBox.y + sealBox.height / 2);
  await expect(threshold).toHaveAttribute("data-threshold-phase", "preview");
  await expect(page.locator("img[data-threshold-preview]")).toBeVisible();

  // And a real tap on "offer this imprint" must commit the offering, not dismiss the box.
  const offer = page.getByRole("button", { name: "offer this imprint" });
  const offerBox = (await offer.boundingBox())!;
  await page.touchscreen.tap(offerBox.x + offerBox.width / 2, offerBox.y + offerBox.height / 2);
  await expect(page.locator('[data-receipt-stage="pending"]'))
    .toContainText("awaiting the Eye", { timeout: 10_000 });
});

test("the mobile preview is a modal focus boundary and restores the threshold seal", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-390", "threshold overlay semantics are a mobile concern");
  await enterTemple(page);

  const seal = page.getByRole("button", { name: "hold the threshold seal" });
  await seal.focus();
  await page.keyboard.down("Enter");
  await page.waitForTimeout(140);
  await page.keyboard.up("Enter");

  const dialog = page.getByRole("dialog", { name: "threshold offering preview" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(page.locator("[data-body-page]")).toHaveAttribute("inert", "");
  await expect(page.locator("[data-reading-column]")).toHaveAttribute("inert", "");
  await expect(page.locator(".temple-sound-toggle")).toHaveAttribute("inert", "");
  await expect(page.getByRole("button", { name: "play the temple sound" })).toHaveCount(0);
  const modalLayers = await page.evaluate(() => ({
    host: Number(getComputedStyle(document.querySelector<HTMLElement>("[data-threshold-host]")!).zIndex),
    sound: Number(getComputedStyle(document.querySelector<HTMLElement>(".temple-sound-toggle")!).zIndex),
  }));
  expect(modalLayers.host).toBeGreaterThan(modalLayers.sound);

  const offer = dialog.getByRole("button", { name: "offer this imprint" });
  const wallet = dialog.getByRole("button", { name: "connect a wallet" });
  await expect(offer).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(wallet).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(offer).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  const restoredSeal = page.getByRole("button", { name: "hold the threshold seal" });
  await expect(restoredSeal).toBeFocused();
  await expect(page.locator("[data-body-page]")).not.toHaveAttribute("inert", "");
  await expect(page.locator("[data-reading-column]")).not.toHaveAttribute("inert", "");
  await expect(page.locator(".temple-sound-toggle")).not.toHaveAttribute("inert", "");
  await expect(page.getByRole("button", { name: "mute the temple" })).toBeVisible();
});

test("announces one genuine receipt transition without replacing the stable receipt ledger", async ({ page }) => {
  executeD1("UPDATE config SET value = '0' WHERE key = 'launched';");
  const offeringId = "portal-receipt-offering";
  await page.addInitScript(({ id, submittedAt }) => {
    window.localStorage.setItem("pleroma:offering-receipts:v1", JSON.stringify([{
      offeringId: id,
      submittedAt,
      stage: "pending",
      eyeTranscriptId: null,
      keepTranscriptId: null,
      relicId: null,
      accretedAt: null,
    }]));
  }, { id: offeringId, submittedAt: Date.now() });

  await enterTemple(page);
  await expect(page.getByRole("region", { name: "the temple" })).toBeVisible({ timeout: 10_000 });
  const receipt = page.locator(`[data-offering-id="${offeringId}"]`);
  await expect(receipt).toHaveAttribute("data-receipt-stage", "pending");
  const originalReceipt = await receipt.elementHandle();
  await expect(receipt).toContainText("awaiting the Eye");
  await expect(page.locator('p[role="status"]').filter({ hasText: "witnessed by the Eye" })).toHaveCount(0);

  await page.evaluate(() => {
    const phrase = "witnessed by the Eye";
    const previous = new WeakMap<Element, string>();
    (window as typeof window & { __receiptAnnouncementCount?: number }).__receiptAnnouncementCount = 0;
    const observe = () => {
      for (const node of document.querySelectorAll('p[role="status"]')) {
        const current = node.textContent?.trim() ?? "";
        if (current === phrase && previous.get(node) !== phrase) {
          const target = window as typeof window & { __receiptAnnouncementCount?: number };
          target.__receiptAnnouncementCount = (target.__receiptAnnouncementCount ?? 0) + 1;
        }
        previous.set(node, current);
      }
    };
    observe();
    new MutationObserver(observe).observe(document.body, { childList: true, subtree: true, characterData: true });
  });

  executeD1(`
    UPDATE config SET value = '1' WHERE key = 'launched';
    INSERT INTO transcripts (id, organ, register, text, offering_id, rite_id, created_at)
    VALUES (
      '01JZPORTALANNOUNCEMENT0000', 'EYE', 'verse',
      'The Eye records the threshold witness.', '${offeringId}', NULL, ${Date.now()}
    );
  `);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

  await expect(page.getByRole("region", { name: "the market" })).toBeVisible({ timeout: 10_000 });
  await expect(receipt).toHaveAttribute("data-receipt-stage", "witnessed", { timeout: 10_000 });
  expect(await receipt.evaluate((node, original) => node === original, originalReceipt)).toBe(true);
  await expect(receipt).toContainText("witnessed by the Eye");
  await expect(page.locator('p[role="status"]').filter({ hasText: "witnessed by the Eye" }))
    .toHaveText("witnessed by the Eye");
  expect(await page.evaluate(() => (
    (window as typeof window & { __receiptAnnouncementCount?: number }).__receiptAnnouncementCount ?? 0
  ))).toBe(1);
});

test("does not repeat a witnessed announcement when later launch state changes", async ({ page }) => {
  executeD1("UPDATE config SET value = '0' WHERE key = 'launched';");
  const offeringId = "sequential-portal-receipt";
  await page.addInitScript(({ id, submittedAt }) => {
    window.localStorage.setItem("pleroma:offering-receipts:v1", JSON.stringify([{
      offeringId: id,
      submittedAt,
      stage: "pending",
      eyeTranscriptId: null,
      keepTranscriptId: null,
      relicId: null,
      accretedAt: null,
    }]));
  }, { id: offeringId, submittedAt: Date.now() });

  await enterTemple(page);
  await expect(page.getByRole("region", { name: "the temple" })).toBeVisible({ timeout: 10_000 });
  const receipt = page.locator(`[data-offering-id="${offeringId}"]`);
  await expect(receipt).toHaveAttribute("data-receipt-stage", "pending");

  await page.evaluate(() => {
    const phrase = "witnessed by the Eye";
    const previous = new WeakMap<Element, string>();
    (window as typeof window & { __sequentialAnnouncementCount?: number }).__sequentialAnnouncementCount = 0;
    const observe = () => {
      for (const node of document.querySelectorAll('p[role="status"]')) {
        const current = node.textContent?.trim() ?? "";
        if (current === phrase && previous.get(node) !== phrase) {
          const target = window as typeof window & { __sequentialAnnouncementCount?: number };
          target.__sequentialAnnouncementCount = (target.__sequentialAnnouncementCount ?? 0) + 1;
        }
        previous.set(node, current);
      }
    };
    observe();
    new MutationObserver(observe).observe(document.body, { childList: true, subtree: true, characterData: true });
  });

  executeD1(`
    INSERT INTO transcripts (id, organ, register, text, offering_id, rite_id, created_at)
    VALUES (
      '01JZSEQUENTIALWITNESS0000', 'EYE', 'verse',
      'The Eye records the dormant witness.', '${offeringId}', NULL, ${Date.now()}
    );
  `);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

  await expect(receipt).toHaveAttribute("data-receipt-stage", "witnessed", { timeout: 10_000 });
  await expect(receipt).toContainText("witnessed by the Eye");
  const announcement = page.locator('p[role="status"]').filter({ hasText: "witnessed by the Eye" });
  await expect(announcement).toHaveText("witnessed by the Eye");
  const originalAnnouncement = await announcement.elementHandle();
  expect(originalAnnouncement).not.toBeNull();
  expect(await page.evaluate(() => (
    (window as typeof window & { __sequentialAnnouncementCount?: number }).__sequentialAnnouncementCount ?? 0
  ))).toBe(1);

  executeD1("UPDATE config SET value = '1' WHERE key = 'launched';");
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

  await expect(page.getByRole("region", { name: "the market" })).toBeVisible({ timeout: 10_000 });
  await expect(receipt).toHaveAttribute("data-receipt-stage", "witnessed");
  await expect(announcement).toHaveText("witnessed by the Eye");
  expect(await announcement.evaluate((node, original) => node === original, originalAnnouncement)).toBe(true);
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => (
    (window as typeof window & { __sequentialAnnouncementCount?: number }).__sequentialAnnouncementCount ?? 0
  ))).toBe(1);
});

test("preserves an active keyboard hold when launch state changes", async ({ page }) => {
  executeD1("UPDATE config SET value = '0' WHERE key = 'launched';");
  await enterTemple(page);
  await expect(page.getByRole("region", { name: "the temple" })).toBeVisible({ timeout: 10_000 });

  const threshold = page.locator("[data-threshold-offering]");
  const seal = page.getByRole("button", { name: "hold the threshold seal" });
  const originalSeal = await seal.elementHandle();
  await seal.focus();
  await page.keyboard.down("Space");
  await expect(threshold).toHaveAttribute("data-threshold-phase", "holding");
  await expect(threshold).toHaveAttribute("data-threshold-locked", "true");

  executeD1("UPDATE config SET value = '1' WHERE key = 'launched';");
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByRole("region", { name: "the market" })).toBeVisible({ timeout: 10_000 });
  await expect(threshold).toHaveAttribute("data-threshold-phase", "holding");
  await expect(threshold).toHaveAttribute("data-threshold-locked", "true");
  expect(await seal.evaluate((node, original) => node === original, originalSeal)).toBe(true);
  await page.keyboard.up("Space");

  await expect(page.locator("img[data-threshold-preview]")).toBeVisible();
});

test("a real rejection retains one preview Blob for an exact retry", async ({ page }) => {
  await enterTemple(page);
  await expect(page.getByRole("region", { name: "the market" })).toBeVisible({ timeout: 10_000 });
  const seal = page.getByRole("button", { name: "hold the threshold seal" });
  await expect(seal).toBeVisible({ timeout: 5_000 });
  await seal.scrollIntoViewIfNeeded();
  await seal.focus();
  await page.keyboard.down("Enter");
  await page.waitForTimeout(120);
  await page.keyboard.up("Enter");

  const preview = page.locator("img[data-threshold-preview]");
  await expect(preview).toBeVisible();
  const originalUrl = await preview.getAttribute("src");
  const windowStart = Math.floor(Date.now() / 60_000) * 60_000;
  executeD1(`
    INSERT INTO rate_limits (bucket, window_start, count)
    VALUES ('ip:0.0.0.0', ${windowStart}, 20);
  `);

  await page.getByRole("button", { name: "offer this imprint" }).click();
  await expect(page.locator("[data-threshold-status]"))
    .toHaveText("rest a moment; the imprint remains at the threshold");
  await expect(preview).toHaveAttribute("src", originalUrl!);

  executeD1("DELETE FROM rate_limits;");
  await page.getByRole("button", { name: "offer this imprint" }).click();
  await expect(page.locator('[data-receipt-stage="pending"]'))
    .toContainText("awaiting the Eye", { timeout: 10_000 });
});

// The offering's own arc (Task 4, grown-lineage-marks): approach, hold, surrender, ripple. The
// forming canvas is the same one Task 3's "forming ink is visible" knock.spec.ts test already
// exercises; this asserts the SHAPE of the arc itself, not just that the canvas exists.
async function formingCanvasHasInk(page: import("@playwright/test").Page): Promise<boolean> {
  return page.locator("canvas.threshold-forming").evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    const context = canvas.getContext("2d");
    if (context === null) return false;
    const alpha = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < alpha.length; index += 4) if (alpha[index] !== 0) return true;
    return false;
  });
}

test("a real hold grows visibly under the finger (Approach ghost, then live Hold growth) before settling into the offered preview", async ({ page }) => {
  // The Approach ghosts the substrate's own residue -- with no kept relic at all there is
  // genuinely nothing to ghost (an honest empty field, not a bug), so this test seeds one real
  // kept relic (image bytes in R2, not just a DB row) the way offering-consequence.live.spec.ts
  // already does, purely so loadSubstrate's own rung 2 ("newest relic") has real residue to find.
  const relicOfferingId = "01JZ0000000000000000000099"; // a valid ULID shape (media.ts's serveOfferingImage requires it)
  putRelicPng(relicOfferingId);
  executeD1(`
    INSERT INTO relics (id, offering_id, wallet, summary, rite_id, kept_at, genesis, accreted_at)
    VALUES ('threshold-arc-residue', '${relicOfferingId}', NULL, 'a residue to grow against', NULL, ${Date.now() - 1_000}, 0, NULL);
  `);

  await enterTemple(page);
  await expect(page.getByRole("region", { name: "the market" })).toBeVisible({ timeout: 10_000 });

  const seal = page.getByRole("button", { name: "hold the threshold seal" });
  await expect(seal).toBeVisible({ timeout: 5_000 });
  await seal.scrollIntoViewIfNeeded();
  const sealBox = (await seal.boundingBox())!;
  const center = { x: sealBox.x + sealBox.width / 2, y: sealBox.y + sealBox.height / 2 };

  // Approach: hovering near the seal, before any press, already ghosts the residue.
  await page.mouse.move(center.x, center.y);
  await expect.poll(() => formingCanvasHasInk(page)).toBe(true);

  // Hold: the same growth simulation steps live under the finger, well past the tap ceiling.
  await page.mouse.down();
  await page.waitForTimeout(200);
  await page.mouse.move(center.x + sealBox.width * 0.2, center.y - sealBox.height * 0.15, { steps: 6 });
  await page.waitForTimeout(400);
  expect(await formingCanvasHasInk(page)).toBe(true);
  await page.screenshot({ path: `e2e/__shots__/threshold-arc-hold-${test.info().project.name}.png` });

  await page.mouse.up();
  const preview = page.locator("img[data-threshold-preview]");
  await expect(preview).toBeVisible({ timeout: 4_000 });
});

test("reduced motion: no mid-hold growth animation, the settled mark still appears on release, and surrender still shows in the status line", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  resetStack();
  executeD1("UPDATE config SET value = '1' WHERE key = 'launched';");
  await enterTemple(page);
  await expect(page.getByRole("region", { name: "the market" })).toBeVisible({ timeout: 10_000 });

  const seal = page.getByRole("button", { name: "hold the threshold seal" });
  await expect(seal).toBeVisible({ timeout: 5_000 });
  await seal.scrollIntoViewIfNeeded();
  const sealBox = (await seal.boundingBox())!;

  await page.mouse.move(sealBox.x + sealBox.width / 2, sealBox.y + sealBox.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(500);
  expect(await formingCanvasHasInk(page)).toBe(false); // no growth animation, no ghost ramp either

  await page.mouse.up();
  const preview = page.locator("img[data-threshold-preview]");
  await expect(preview).toBeVisible({ timeout: 4_000 }); // the settled mark still appears at once

  // Surrender's status line is real state, not an animation -- catch it even if the real submit
  // resolves before Playwright's own poll would otherwise observe the transient text.
  await page.evaluate((expected) => {
    const node = document.querySelector("[data-threshold-status]")!;
    const seen = () => node.textContent === expected;
    (window as typeof window & { __sawSurrenderStatus?: boolean }).__sawSurrenderStatus = seen();
    new MutationObserver(() => {
      if (seen()) (window as typeof window & { __sawSurrenderStatus?: boolean }).__sawSurrenderStatus = true;
    }).observe(node, { childList: true, characterData: true, subtree: true });
  }, "the page takes it");

  await page.getByRole("button", { name: "offer this imprint" }).click();
  await expect(page.locator('[data-receipt-stage="pending"]'))
    .toContainText("awaiting the Eye", { timeout: 10_000 });
  expect(await page.evaluate(() => (
    (window as typeof window & { __sawSurrenderStatus?: boolean }).__sawSurrenderStatus
  ))).toBe(true);

  await ctx.close();
});
