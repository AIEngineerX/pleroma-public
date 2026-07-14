import { expect, test } from "@playwright/test";
import { resetStack } from "./helpers/workerFixture";

test.beforeEach(() => resetStack());

test("the Stain renders ink on parchment (one-glance)", async ({ page }) => {
  const webglErrors: string[] = [];
  page.on("console", message => {
    if (message.type() === "error" && /webgl|shader|framebuffer/i.test(message.text())) webglErrors.push(message.text());
  });
  await page.goto("/");
  // OfferingCanvas mounts a second canvas; the simulation identifies only the membrane it owns.
  const canvas = page.locator("canvas[data-organ-swarm]");
  // desktop/mobile tiers create a canvas; reduced-motion (not set here) would not.
  await expect(canvas).toBeVisible();
  await expect(page.locator(".visage")).toHaveCount(0);
  await page.waitForTimeout(1200);                            // let the sim advect a few frames
  expect(await canvas.evaluate((node: HTMLCanvasElement) => {
    const gl = node.getContext("webgl2");
    return gl ? gl.getError() : -1;
  })).toBe(0);
  expect(webglErrors).toEqual([]);
  await page.screenshot({ path: `e2e/__shots__/stain-${test.info().project.name}.png` });
});

test("reduced motion settles the five organs without creating a GL loop", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("svg.swarm-settled")).toBeVisible();
  await expect(page.locator("canvas[data-organ-swarm]")).toHaveCount(0);
  await expect(page.locator(".visage")).toHaveCount(0);
});
