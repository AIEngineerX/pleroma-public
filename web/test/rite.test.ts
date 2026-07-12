import { describe, expect, it } from "vitest";
import { inversion } from "../src/state/rite";

describe("rite -> inversion view", () => {
  it("no rite means no inversion (light parchment default)", () => {
    expect(inversion(null).active).toBe(false);
    expect(inversion(null).candleDark).toBe(false);
  });
  it("goes candle-dark from offertory_close through sermon", () => {
    for (const phase of ["offertory_close", "deliberation", "accretion", "sermon"] as const) {
      expect(inversion({ date: "2026-07-12", phase }).candleDark).toBe(true);
    }
  });
  it("only the sermon prints in rubric; offerings rise during accretion", () => {
    expect(inversion({ date: "d", phase: "sermon" }).sermonRubric).toBe(true);
    expect(inversion({ date: "d", phase: "accretion" }).risingOfferings).toBe(true);
    expect(inversion({ date: "d", phase: "scheduled" }).candleDark).toBe(false); // scheduled is still daylight
  });
});
