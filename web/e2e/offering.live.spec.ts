import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  executeD1,
  readR2Object,
  resetStack,
} from "./helpers/workerFixture";

test.beforeEach(() => {
  resetStack();
  executeD1("UPDATE config SET value = '1' WHERE key = 'launched';");
});

test("offers the exact real preview PNG and creates only a pending receipt", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("region", { name: "the market" })).toBeVisible({ timeout: 10_000 });

  const seal = page.getByRole("button", { name: "hold the threshold seal" });
  await expect(seal).toBeVisible({ timeout: 5_000 });
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
  await expect.poll(() => seal.evaluate((node) => (node as HTMLButtonElement).hasPointerCapture(1))).toBe(false);

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
});

test("keyboard hold creates a preview and letting it fade releases the threshold", async ({ page }) => {
  executeD1("UPDATE config SET value = '0' WHERE key = 'launched';");
  await page.goto("/");
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

  await page.goto("/");
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

  await page.goto("/");
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
  await page.goto("/");
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
  await page.goto("/");
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
