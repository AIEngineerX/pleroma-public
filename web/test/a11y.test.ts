import { describe, expect, it } from "vitest";
import { contrastRatio } from "../src/lib/a11y";

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
