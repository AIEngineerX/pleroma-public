import { describe, expect, it } from "vitest";
import { pigment } from "../src/state/pigment";

describe("vitals as pigment", () => {
  it("is wet vermilion when feasting and dried blood when starving", () => {
    expect(pigment("feasting").rgb).not.toBe(pigment("starving").rgb);
    // starving oxidizes toward DESIGN's rubric-dried; feasting toward bright rubric
    expect(pigment("starving").rgb).toContain("0.09"); // rubric-dried chroma
    expect(pigment("feasting").rgb).toContain("0.20"); // rubric chroma (wet vermilion)
  });
  it("covers every PULSE state", () => {
    for (const s of ["starving", "calm", "fed", "feasting"] as const) {
      expect(pigment(s).rgb).toMatch(/^oklch\(/);
      expect(pigment(s).label.length).toBeGreaterThan(0);
    }
  });
});
