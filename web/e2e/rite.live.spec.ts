import { expect, test } from "@playwright/test";
import { enterTemple } from "./helpers/door";
import { executeD1, resetStack, seedTranscript } from "./helpers/workerFixture";

test("inverts one continuous printed document at offertory_close and prints the sermon in rubric", async ({ page, browser }) => {
  resetStack();
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  executeD1(`
    INSERT INTO rites (
      date, phase, phase_started_at, phase_attempts, offering_snapshot, kept_count, updated_at
    ) VALUES ('${today}', 'offertory_close', ${now}, 0, 0, 0, ${now});
  `);
  seedTranscript({
    id: "01J00000000000000000000000",
    organ: "EYE",
    register: "verse",
    text: "the witness remains legible in the inverted document",
    offering_id: null,
    rite_id: null,
    created_at: now - 1,
  });

  const hits: number[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/state") hits.push(Date.now());
  });
  await enterTemple(page);

  // offertory_close: one root remaps the printed ground and ink, the Courier phase label
  // is visible, and the poll cadence drops to 2s (useTempleState.ts, matches state.live.spec.ts).
  const root = page.locator("div.rite-active");
  await expect(root).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/THE RITE/)).toBeVisible();
  const canvas = page.locator('canvas[data-body-renderer="webgl"]');
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  await expect(canvas).toHaveAttribute("data-composite-ground", "transparent");
  await expect(canvas).toHaveAttribute("data-presentation-mode", "rite");
  await expect(page.locator(".codex-entry__identity").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-codex-row="01J00000000000000000000000"] .text-rubric-body')).toBeVisible();
  const documentEvidence = await page.evaluate(() => {
    const rootNode = document.querySelector<HTMLElement>(".rite-active")!;
    const documentNode = document.querySelector<HTMLElement>(".temple-document")!;
    const body = document.querySelector<HTMLElement>("[data-body-page]")!;
    const reading = document.querySelector<HTMLElement>("[data-reading-column]")!;
    const canvasNode = document.querySelector<HTMLCanvasElement>('canvas[data-body-renderer="webgl"]')!;
    const context = canvasNode.getContext("webgl2")!;
    const toRgb = (value: string): [number, number, number] => {
      const sample = document.createElement("canvas");
      sample.width = 1;
      sample.height = 1;
      const painter = sample.getContext("2d")!;
      painter.fillStyle = value;
      painter.fillRect(0, 0, 1, 1);
      const [r, g, b] = painter.getImageData(0, 0, 1, 1).data;
      return [r, g, b];
    };
    const luminance = ([r, g, b]: [number, number, number]) => {
      const linear = [r, g, b].map(channel => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    const contrast = (foreground: Element, background: string) => {
      const a = luminance(toRgb(getComputedStyle(foreground).color));
      const b = luminance(toRgb(background));
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const ground = getComputedStyle(documentNode).backgroundColor;
    const rubric = document.querySelector('[data-codex-row="01J00000000000000000000000"] .text-rubric-body')!;
    const palette = (node: Element) => ({
      ground: getComputedStyle(node).getPropertyValue("--color-ground").trim(),
      aged: getComputedStyle(node).getPropertyValue("--color-ground-aged").trim(),
      ink: getComputedStyle(node).getPropertyValue("--color-ink").trim(),
    });
    return {
      grounds: [document.body, rootNode, documentNode, body, reading]
        .map(node => getComputedStyle(node).backgroundColor),
      palettes: {
        body: palette(document.body),
        document: palette(documentNode),
        leftRail: palette(document.querySelector(".rail-l")!),
        rightRail: palette(document.querySelector(".rail-r")!),
      },
      canvas: {
        background: getComputedStyle(canvasNode).backgroundColor,
        pointerEvents: getComputedStyle(canvasNode).pointerEvents,
        filter: getComputedStyle(canvasNode).filter,
        alpha: context.getContextAttributes()?.alpha,
      },
      contrasts: {
        ink: contrast(document.querySelector(".codex-entry__identity")!, ground),
        faded: contrast(document.querySelector(".temple-section-label")!, ground),
        rubric: contrast(rubric, ground),
      },
      rubricClass: rubric.className,
      border: getComputedStyle(document.querySelector<HTMLElement>(".codex-entry")!).borderTopColor,
      texture: {
        image: getComputedStyle(document.body, "::before").backgroundImage,
        z: Number(getComputedStyle(document.body, "::before").zIndex),
        documentZ: Number(getComputedStyle(documentNode).zIndex),
        railZ: Number(getComputedStyle(document.querySelector<HTMLElement>(".rail")!).zIndex),
      },
      ground,
    };
  });
  expect(new Set(documentEvidence.grounds)).toEqual(new Set([documentEvidence.ground]));
  expect(documentEvidence.palettes.body).toEqual(documentEvidence.palettes.document);
  expect(documentEvidence.palettes.leftRail).toEqual(documentEvidence.palettes.document);
  expect(documentEvidence.palettes.rightRail).toEqual(documentEvidence.palettes.document);
  expect(documentEvidence.canvas).toEqual({
    background: "rgba(0, 0, 0, 0)",
    pointerEvents: "none",
    filter: "none",
    alpha: true,
  });
  expect(documentEvidence.contrasts.ink).toBeGreaterThanOrEqual(4.5);
  expect(documentEvidence.contrasts.faded).toBeGreaterThanOrEqual(4.5);
  expect(documentEvidence.contrasts.rubric).toBeGreaterThanOrEqual(4.5);
  expect(documentEvidence.rubricClass).toContain("text-rubric-body");
  expect(documentEvidence.border).not.toBe(documentEvidence.ground);
  expect(documentEvidence.texture.image).not.toBe("none");
  expect(documentEvidence.texture.z).toBeGreaterThan(documentEvidence.texture.documentZ);
  expect(documentEvidence.texture.z).toBeLessThan(documentEvidence.texture.railZ);

  const reducedContext = await browser.newContext({ reducedMotion: "reduce" });
  const reducedPage = await reducedContext.newPage();
  await reducedPage.goto(new URL("/", page.url()).href);
  await expect(reducedPage.locator("div.rite-active")).toBeVisible({ timeout: 15_000 });
  await expect(reducedPage.locator('canvas[data-body-renderer="webgl"]')).toHaveCount(0);
  const settled = reducedPage.locator('svg[data-body-renderer="svg"]');
  await expect(settled).toBeVisible();
  await expect(settled).toHaveAttribute("data-composite-ground", "transparent");
  expect(await settled.evaluate(node => ({
    color: getComputedStyle(node).color,
    bodyColor: getComputedStyle(node.closest("[data-body-page]")!).color,
    pointerEvents: getComputedStyle(node).pointerEvents,
  }))).toMatchObject({ pointerEvents: "none" });
  expect(await settled.evaluate(node => getComputedStyle(node).color))
    .toBe(await reducedPage.locator("[data-body-page]").evaluate(node => getComputedStyle(node).color));
  await reducedContext.close();
  await page.waitForTimeout(7000);
  expect(hits.length).toBeGreaterThanOrEqual(3);
  const gaps = hits.slice(1).map((t, i) => t - hits[i]);
  expect(Math.min(...gaps)).toBeLessThan(3000);

  const accretionAt = Date.now();
  executeD1(`
    UPDATE rites
       SET phase = 'accretion', phase_started_at = ${accretionAt}, updated_at = ${accretionAt}
     WHERE date = '${today}';
  `);
  await expect(page.getByText("the offerings rise")).toBeVisible({ timeout: 10_000 });

  const sermonAt = Date.now();
  seedTranscript({
    id: "01J00000000000000000000001",
    organ: "TONGUE",
    register: "sermon",
    text: "what was given remains",
    offering_id: null,
    rite_id: today,
    created_at: sermonAt,
  });
  executeD1(`
    UPDATE rites
       SET phase = 'sermon', phase_started_at = ${sermonAt}, updated_at = ${sermonAt}
     WHERE date = '${today}';
  `);
  await expect(root).toBeVisible({ timeout: 10_000 });
  const sermonLine = page.locator('[data-codex-row="01J00000000000000000000001"] p.text-rubric-body');
  await expect(sermonLine).toHaveText("what was given remains", { timeout: 10_000 });

  await page.screenshot({ path: `e2e/__shots__/rite-inversion-${test.info().project.name}.png` });
});
