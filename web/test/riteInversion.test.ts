import { describe, expect, it } from "vitest";
import { inversionClasses } from "../src/rite/RiteInversion";
import { inversion } from "../src/state/rite";

describe("rite inversion classes", () => {
  it("applies candle-dark only when the rite view is candleDark", () => {
    expect(inversionClasses(inversion({ date: "d", phase: "sermon" }))).toContain("rite-active");
    expect(inversionClasses(inversion({ date: "d", phase: "scheduled" }))).not.toContain("rite-active");
    expect(inversionClasses(inversion(null))).not.toContain("rite-active");
  });
});
