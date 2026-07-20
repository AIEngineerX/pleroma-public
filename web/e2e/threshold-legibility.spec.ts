import { expect, test } from "@playwright/test";
import { enterTemple } from "./helpers/door";

// The Threshold consent line (and the post-offering confirm feedback) sit OVER the Stain, whose
// ink density is stochastic. Six mobile fixes tuned a parchment wash and it regressed every time
// (see CLAUDE.md "Anything composited over the Stain..."): no single wash opacity is legible over
// dense ink AND unobtrusive over faint ink. The permanent fix is a background-INDEPENDENT letterpress
// outline. This test renders the consent over the darkest ink the Stain can reach and pins that
// mechanism, so a future edit that reintroduces a wash box, or drops/weakens the outline, fails HERE
// instead of in front of a visitor. It asserts (1) no opaque backing box and (2) a parchment
// glyph-outline in the ground color — the contrast that does not depend on what is behind — and saves
// a screenshot artifact over the worst-case backdrop for the human legibility check.
test.describe("Threshold consent stays legible over the Stain at any density", () => {
  for (const selector of ["[data-threshold-terms]"]) {
    test(`consent uses a background-independent outline, not a density-tuned wash (${selector})`, async ({ page }, testInfo) => {
      await enterTemple(page);
      const el = page.locator(selector);
      await expect(el).toBeVisible();

      const probe = await page.evaluate((sel) => {
        // Resolve the parchment ground token to its serialized color for comparison.
        const groundEl = document.createElement("span");
        groundEl.style.color = "var(--color-ground)";
        document.body.appendChild(groundEl);
        const ground = getComputedStyle(groundEl).color;
        groundEl.remove();
        // Force the worst case: paint everything behind the consent the darkest ink and remove the
        // live WebGL canvas, so the backdrop is a deterministic solid dark rather than a random Stain.
        document.querySelectorAll(".temple-body-page").forEach((n) => {
          (n as HTMLElement).style.background = "oklch(0.25 0.02 60)"; // --color-ink, the darkest ink
        });
        document.querySelectorAll("canvas[data-body-renderer]").forEach((c) => {
          (c as HTMLElement).style.display = "none";
        });
        const t = document.querySelector(sel) as HTMLElement;
        const cs = getComputedStyle(t);
        return {
          ground,
          backgroundImage: cs.backgroundImage,
          backgroundColor: cs.backgroundColor,
          textShadow: cs.textShadow,
        };
      }, selector);

      // (1) No opaque backing box — the panel that buried the hero across six prior fixes.
      expect(probe.backgroundImage).toBe("none");
      expect(["rgba(0, 0, 0, 0)", "transparent"]).toContain(probe.backgroundColor);

      // (2) The parchment outline is present: a multi-directional glyph ring in the GROUND color
      // (not the ink), giving contrast independent of the ink behind. Weakening it below the ring
      // (fewer layers) or recoloring it fails here.
      expect(probe.textShadow).not.toBe("none");
      const ringLayers = probe.textShadow.split(probe.ground).length - 1;
      expect(ringLayers).toBeGreaterThanOrEqual(6);

      // Human-review artifact: the consent as it renders over the darkest possible Stain.
      await el.screenshot({
        path: `e2e/__shots__/consent-over-dense-stain-${testInfo.project.name}.png`,
      });
    });
  }
});
