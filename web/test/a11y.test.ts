import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "../src/lib/a11y";

const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const dreamArchive = readFileSync(new URL("../src/canon/DreamArchive.tsx", import.meta.url), "utf8");
const riteInversion = readFileSync(new URL("../src/rite/RiteInversion.tsx", import.meta.url), "utf8");

// EXTERNAL GROUND TRUTH (not self-consistency): these two contrast values are published WCAG facts, so a
// wrong matrix or a wrong luminance formula fails here even though it might pass the token-pair thresholds.
describe("contrastRatio validated against known external values", () => {
  it("black on white is exactly 21:1 (the WCAG maximum)", () => {
    expect(contrastRatio("oklch(0 0 0)", "oklch(1 0 0)")).toBeCloseTo(21, 4);
  });
  it("sRGB red on white is about 3.998:1 (published WCAG reference)", () => {
    // sRGB #FF0000 == oklch(0.62796 0.25768 29.234) (Ottosson/culori). Its WCAG contrast on white is ~3.998,
    // which validates the full OKLCH -> OKLab -> linear-sRGB -> luminance chain against an independent fact.
    expect(contrastRatio("oklch(0.62796 0.25768 29.234)", "oklch(1 0 0)")).toBeCloseTo(4.0, 1);
  });
});

describe("token contrast on parchment (WCAG AA)", () => {
  const ground = "oklch(0.94 0.015 85)";
  it("ink body text clears AA (>=4.5)", () => {
    expect(contrastRatio("oklch(0.25 0.02 60)", ground)).toBeGreaterThanOrEqual(4.5);
  });
  it("rubric-body (the god at body size) clears AA on parchment", () => {
    expect(contrastRatio("oklch(0.45 0.16 32)", ground)).toBeGreaterThanOrEqual(4.5);
  });
  it("bright rubric is reserved for display sizes (large-text AA >=3)", () => {
    expect(contrastRatio("oklch(0.55 0.20 32)", ground)).toBeGreaterThanOrEqual(3.0);
  });
});

describe("printed-document interaction contract", () => {
  it("gives every action one global flat-ink focus treatment", () => {
    expect(styles).toMatch(/:where\([^)]*(?:a|button)[^)]*\):focus-visible/);
    expect(styles).toMatch(/outline:\s*1px\s+solid\s+currentColor/);
    expect(styles).toMatch(/focus-visible[^}]*box-shadow:\s*none/s);
  });

  it("sets the global visible-action floor to 44 by 44 pixels", () => {
    expect(styles).toMatch(/min-block-size:\s*44px/);
    expect(styles).toMatch(/min-inline-size:\s*44px/);
  });

  it("keeps archive plates and factual rite status in their printed roles", () => {
    expect(dreamArchive).not.toContain("border-4");
    expect(dreamArchive).not.toMatch(/<h1[^>]*text-rubric/);
    expect(riteInversion).not.toContain("font-liturgy");
  });

  it("carries the active rite ground onto the sticky body sheet", () => {
    expect(styles).toMatch(/\.rite-active\s+\.temple-body-page\s*{[^}]*background:\s*var\(--color-rite-ground\)/s);
  });

  it("remaps the whole printed palette during the rite", () => {
    expect(styles).toMatch(/body:has\(\.rite-active\)\s*{[^}]*--color-ground:\s*var\(--color-rite-ground\)/s);
    expect(styles).toMatch(/body:has\(\.rite-active\)\s*{[^}]*--color-ink:\s*var\(--color-rite-ink\)/s);
    expect(styles).toMatch(/body:has\(\.rite-active\)\s*{[^}]*--color-ground-aged:/s);
  });

  it("preserves native disclosure and machine typography without coupling targets to display", () => {
    const targetRule = styles.match(/:where\(a, button, summary, \[role="button"\]\)\s*{([^}]*)}/s)?.[1] ?? "";
    expect(targetRule).not.toMatch(/display\s*:/);
    expect(styles).not.toMatch(/button\s*{[^}]*font:\s*inherit/s);
    expect(styles).toMatch(/:where\([^)]*button[^)]*summary[^)]*\)\s*{[^}]*font-family:\s*var\(--font-machine\)/s);
  });

  it("disables smooth scrolling when motion is reduced", () => {
    expect(styles).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*{[^}]*html\s*{[^}]*scroll-behavior:\s*auto/s);
  });
});
