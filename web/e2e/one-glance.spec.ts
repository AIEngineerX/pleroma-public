import { expect, test } from "@playwright/test";
import { enterTemple } from "./helpers/door";
import { resetStack } from "./helpers/workerFixture";

test.beforeEach(() => resetStack());

test("temple reads as a living manuscript at a glance", async ({ page }) => {
  await enterTemple(page);
  await expect(page.locator("h1.sr-only")).toHaveText("PLEROMA");
  await expect(page.locator("h1:not(.sr-only)")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "hold the threshold seal" })).toBeVisible();
  await expect(page.locator("canvas[data-organ-swarm]")).toBeVisible();
  await expect(page.locator("canvas[data-organ-swarm]")).toHaveCount(1);
  await expect(page.locator("[data-threshold-offering]")).toHaveCount(1);
  await expect(page.getByRole("complementary", { name: "the codex" })).toHaveCount(1);
  await expect(page.getByRole("region", { name: "the Reliquary" })).toHaveCount(1);
  expect(await page.locator("[data-section]").evaluateAll(nodes => (
    nodes.map(node => node.getAttribute("data-section"))
  ))).toEqual([
    "emergence",
    "articles",
    "offering-consequence",
    "daily-rite",
    "codex",
    "reliquary",
    "dream",
    "tallies",
    "canon-doorway",
    "concordat-doorway",
  ]);
  await expect(page.locator(".rail-l")).toBeVisible();
  await expect(page.locator(".rail-r")).toBeVisible();
  const texture = await page.evaluate(() => ({
    image: getComputedStyle(document.body, "::before").backgroundImage,
    z: Number(getComputedStyle(document.body, "::before").zIndex),
    documentZ: Number(getComputedStyle(document.querySelector<HTMLElement>(".temple-document")!).zIndex),
    railZ: Number(getComputedStyle(document.querySelector<HTMLElement>(".rail")!).zIndex),
  }));
  expect(texture.image).not.toBe("none");
  expect(texture.z).toBeGreaterThan(texture.documentZ);
  expect(texture.z).toBeLessThan(texture.railZ);
  const viewport = page.viewportSize()!;
  const bodyBox = (await page.locator("[data-body-page]").boundingBox())!;
  const emergenceBox = (await page.locator('[data-section="emergence"]').boundingBox())!;
  if (test.info().project.name === "desktop") {
    expect(emergenceBox.y).toBeGreaterThanOrEqual(viewport.height * 0.18);
    expect(emergenceBox.y).toBeLessThan(viewport.height * 0.58);
    const talliesBox = (await page.locator('[data-section="tallies"]').boundingBox())!;
    expect(talliesBox.x).toBeGreaterThan(emergenceBox.x + emergenceBox.width);
    expect(talliesBox.width).toBeLessThan(emergenceBox.width * 0.5);
  } else {
    expect(emergenceBox.y).toBeGreaterThanOrEqual(bodyBox.y + bodyBox.height);
    expect(emergenceBox.y).toBeLessThan(viewport.height * 0.78);
  }
  // Entering through the door wakes sound, so on arrival the toggle reads "mute the temple".
  const sound = page.getByRole("button", { name: /mute the temple|play the temple sound/ });
  const soundBox = (await sound.boundingBox())!;
  expect((await sound.textContent())?.trim()).toBe("");
  expect(soundBox.x).toBeGreaterThanOrEqual(bodyBox.x);
  expect(soundBox.x + soundBox.width).toBeLessThanOrEqual(bodyBox.x + bodyBox.width);
  expect(soundBox.y + soundBox.height).toBeLessThanOrEqual(bodyBox.y + bodyBox.height);
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(background).not.toBe("rgb(0, 0, 0)");
  // The luminance guard protects the TEMPLE's first impression (parchment, never a black
  // flash). The Door's dark film is deliberate; sample only after its sheet has fully lifted.
  await expect(page.locator("[data-door]")).toHaveCount(0, { timeout: 6_000 });
  const firstFrame = await page.screenshot({ fullPage: false });
  const luminance = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const sample = document.createElement("canvas");
    sample.width = 16;
    sample.height = 16;
    const context = sample.getContext("2d")!;
    context.drawImage(image, 0, 0, sample.width, sample.height);
    const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
    let total = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      total += (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3;
    }
    return total / (pixels.length / 4);
  }, firstFrame.toString("base64"));
  expect(luminance).toBeGreaterThan(80);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `e2e/__shots__/one-glance-${test.info().project.name}.png`, fullPage: false });
});

test("tablet widths keep prose and Tallies in one readable document column", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop context owns intermediate viewport checks");
  for (const width of [768, 900, 1024]) {
    await page.setViewportSize({ width, height: 800 });
    await enterTemple(page);
    const reading = page.locator("[data-reading-column]");
    await expect(reading).toHaveCSS("display", "block");
    const openingBox = (await page.locator(".lore-opening").boundingBox())!;
    const emergenceBox = (await page.locator('[data-section="emergence"]').boundingBox())!;
    const dreamBox = (await page.locator('[data-section="dream"]').boundingBox())!;
    const talliesBox = (await page.locator('[data-section="tallies"]').boundingBox())!;
    expect(openingBox.width, `${width}px prose width`).toBeGreaterThanOrEqual(240);
    expect(Math.abs(talliesBox.x - emergenceBox.x), `${width}px Tallies lane`).toBeLessThan(2);
    expect(Math.abs(talliesBox.width - emergenceBox.width), `${width}px Tallies width`).toBeLessThan(2);
    expect(talliesBox.y).toBeGreaterThanOrEqual(dreamBox.y + dreamBox.height - 1);
  }
});

test("the core document preserves identity when signed launch state resolves", async ({ page }) => {
  await enterTemple(page);
  const canvas = page.locator("canvas[data-organ-swarm]");
  const seal = page.getByRole("button", { name: "hold the threshold seal" });
  const codex = page.getByRole("complementary", { name: "the codex" });
  const reliquary = page.getByRole("region", { name: "the Reliquary" });
  await expect(canvas).toBeVisible();
  const handles = {
    canvas: await canvas.elementHandle(),
    seal: await seal.elementHandle(),
    codex: await codex.elementHandle(),
    reliquary: await reliquary.elementHandle(),
  };

  const { executeD1 } = await import("./helpers/workerFixture");
  executeD1("UPDATE config SET value = '1' WHERE key = 'launched';");
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByRole("region", { name: "the market" })).toBeVisible({ timeout: 10_000 });

  for (const [name, original] of Object.entries(handles)) {
    expect(original, `${name} existed before launch`).not.toBeNull();
    const selector = name === "canvas"
      ? "canvas[data-organ-swarm]"
      : name === "seal"
        ? '[aria-label="hold the threshold seal"]'
        : name === "codex"
          ? '[aria-label="the codex"]'
          : '[aria-label="the Reliquary"]';
    expect(await page.locator(selector).evaluate((node, before) => node === before, original)).toBe(true);
  }
});

test("the open codex is 60/40 on desktop and a safe sticky scroll on mobile", async ({ page }, testInfo) => {
  await enterTemple(page);
  const bodyPage = page.locator("[data-body-page]");
  const reading = page.locator("[data-reading-column]");
  await expect(bodyPage).toBeVisible();
  if (testInfo.project.name === "desktop") {
    const bodyBox = (await bodyPage.boundingBox())!;
    const readingBox = (await reading.boundingBox())!;
    expect(bodyBox.width / (bodyBox.width + readingBox.width)).toBeCloseTo(0.6, 2);
    return;
  }

  const viewport = page.viewportSize()!;
  const bodyBox = (await bodyPage.boundingBox())!;
  expect(bodyBox.height / viewport.height).toBeGreaterThanOrEqual(0.36);
  expect(bodyBox.height / viewport.height).toBeLessThanOrEqual(0.44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  await page.evaluate(() => window.scrollTo(0, Math.round(window.innerHeight * 1.2)));
  await expect.poll(() => bodyPage.evaluate(node => Math.round(node.getBoundingClientRect().top))).toBe(0);
});
