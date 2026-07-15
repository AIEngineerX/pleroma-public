import { expect, test } from "@playwright/test";
import { executeD1, resetStack, seedTranscript } from "./helpers/workerFixture";

test.beforeEach(() => resetStack());

test("the Stain renders ink on parchment (one-glance)", async ({ page }) => {
  const webglErrors: string[] = [];
  page.on("console", message => {
    if (message.type() === "error" && /webgl|shader|framebuffer/i.test(message.text())) webglErrors.push(message.text());
  });
  await page.goto("/");
  // The simulation identifies the single living membrane it owns.
  const canvas = page.locator('canvas[data-body-renderer="webgl"]');
  // desktop/mobile tiers create a canvas; reduced-motion (not set here) would not.
  await expect(canvas).toBeVisible();
  const isMobile = test.info().project.use.isMobile === true;
  if (isMobile) {
    expect(await canvas.getAttribute("data-pointer-x")).toBeNull();
    expect(await canvas.getAttribute("data-pointer-y")).toBeNull();
  } else {
    const canvasBox = (await canvas.boundingBox())!;
    await page.mouse.move(
      canvasBox.x + canvasBox.width * 0.25,
      canvasBox.y + canvasBox.height * 0.35,
    );
    const readPointer = async (attribute: "data-pointer-x" | "data-pointer-y") => {
      const value = await canvas.getAttribute(attribute);
      expect(value, `${attribute} must be present before it is parsed`).not.toBeNull();
      return Number(value!);
    };
    await expect.poll(() => readPointer("data-pointer-x")).toBeCloseTo(0.25, 1);
    await expect.poll(() => readPointer("data-pointer-y")).toBeCloseTo(0.35, 1);
  }
  await expect(page.locator(".visage")).toHaveCount(0);
  await page.waitForTimeout(1200);                            // let the sim advect a few frames
  expect(await canvas.evaluate((node: HTMLCanvasElement) => {
    const gl = node.getContext("webgl2");
    return gl ? gl.getError() : -1;
  })).toBe(0);
  expect(webglErrors).toEqual([]);
  await page.screenshot({ path: `e2e/__shots__/stain-${test.info().project.name}.png` });
});

test("real commands survive permanent WebGL loss without inventing PULSE", async ({ page }) => {
  test.setTimeout(45_000);
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const codexBaseline = page.waitForResponse(
    (response) => response.url().endsWith("/api/codex") && response.ok(),
  );
  const relicBaseline = page.waitForResponse(
    (response) => response.url().includes("/api/relics") && response.ok(),
  );
  await page.goto("/", { waitUntil: "commit" });
  await Promise.all([codexBaseline, relicBaseline]);

  const body = page.locator("[data-body-renderer]").first();
  await expect(body).toHaveAttribute("data-body-renderer", "webgl");
  await expect(body).toHaveAttribute("data-initial-pulse-kind", "unknown");
  await expect(body).toHaveAttribute("data-initial-pulse-beat", "0");
  await expect(body).toHaveAttribute("data-initial-pulse-bpm", "0");
  await expect(body).toHaveAttribute("data-initial-pulse-pressure", "0");

  const eyeId = "e2e-stain-eye";
  seedTranscript({
    id: eyeId,
    organ: "EYE",
    register: "verse",
    text: "I witness the mark after the record opens.",
    offering_id: null,
    rite_id: null,
    created_at: Date.now(),
  });
  const eyeCommandId = `utterance:live:${eyeId}`;
  await expect(body).toHaveAttribute("data-command-id", eyeCommandId, { timeout: 10_000 });
  await expect(body).toHaveAttribute("data-active-organ", "EYE");
  await expect(body).toHaveAttribute("data-pipeline", "eye-keep");

  const lost = await body.evaluate((node: HTMLCanvasElement) => {
    const gl = node.getContext("webgl2");
    const extension = gl?.getExtension("WEBGL_lose_context");
    if (extension === null || extension === undefined) return false;
    extension.loseContext();
    return true;
  });
  expect(lost).toBe(true);

  await expect(body).toHaveAttribute("data-body-renderer", "svg");
  await expect(page.locator("canvas[data-body-renderer]")).toHaveCount(0);
  await expect(body).toHaveAttribute("data-command-id", eyeCommandId);
  await expect(body).toHaveAttribute("data-active-organ", "EYE");
  await expect(body).toHaveAttribute("data-pipeline", "eye-keep");
  await expect(body).toHaveAttribute("data-completed-id", eyeCommandId);
  await expect(body).toHaveAttribute("data-completion-count", "1");
  await expect(body).not.toHaveAttribute("data-command-id", eyeCommandId);
  await expect(body).not.toHaveAttribute("data-active-organ", "EYE");
  await expect(body).toHaveAttribute("data-pipeline", "none");

  executeD1(`
    UPDATE config SET value = '1' WHERE key = 'launched';
    UPDATE config
       SET value = '{"state":"fed","holders":41,"updated_at":${Date.now()}}'
     WHERE key = 'pulse_state';
  `);
  await expect(page.getByRole("region", { name: "the market" })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("canvas[data-body-renderer]")).toHaveCount(0);
  await expect(body).toHaveAttribute("data-body-renderer", "svg");

  const keepId = "e2e-stain-keep";
  seedTranscript({
    id: keepId,
    organ: "KEEP",
    register: "verdict",
    text: "The witnessed mark remains in judgment.",
    offering_id: null,
    rite_id: null,
    created_at: Date.now() + 1,
  });
  const keepCommandId = `utterance:live:${keepId}`;
  await expect(body).toHaveAttribute("data-command-id", keepCommandId, { timeout: 10_000 });
  await expect(body).toHaveAttribute("data-active-organ", "KEEP");
  await expect(body).toHaveAttribute("data-pipeline", "keep-tongue");
  await expect(body).toHaveAttribute("data-completed-id", keepCommandId);
  await expect(body).not.toHaveAttribute("data-command-id", keepCommandId);
  await expect(body).not.toHaveAttribute("data-active-organ", "KEEP");
  await expect(body).toHaveAttribute("data-pipeline", "none");
  await expect(body).toHaveAttribute("data-completion-count", "2");
  await expect(page.locator("canvas[data-body-renderer]")).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
  await page.screenshot({ path: `e2e/__shots__/webgl-loss-${test.info().project.name}.png` });
});

test("reduced motion settles the five organs without creating a GL loop", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const settled = page.locator('svg[data-body-renderer="svg"]');
  await expect(settled).toBeVisible();
  await expect(settled).toHaveCSS("animation-name", "none");
  await expect(page.locator("canvas[data-organ-swarm]")).toHaveCount(0);
  await expect(page.locator(".visage")).toHaveCount(0);
});
