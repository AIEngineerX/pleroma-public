import { describe, expect, it } from "vitest";
import { isFirstLightView } from "../src/state/types";

describe("isFirstLightView", () => {
  it("accepts the not-yet-enacted shape", () => {
    expect(isFirstLightView({ enacted: false, relic: null, dream: null })).toBe(true);
  });

  it("accepts a fully enacted shape with relic and dream", () => {
    expect(isFirstLightView({
      enacted: true,
      relic: {
        id: "r1", offering_id: "o1", summary: "a founding mark", rite_id: "2026-07-17", genesis: 1,
        kept_at: 100, accreted_at: 200,
      },
      dream: { rite_date: "2026-07-17", narrative: "the first dream", video_key: null, created_at: 300 },
    })).toBe(true);
  });

  it("accepts a relic not yet accreted (accreted_at null)", () => {
    expect(isFirstLightView({
      enacted: true,
      relic: {
        id: "r1", offering_id: "o1", summary: "a founding mark", rite_id: null, genesis: 1,
        kept_at: 100, accreted_at: null,
      },
      dream: null,
    })).toBe(true);
  });

  it("rejects a missing enacted flag", () => {
    expect(isFirstLightView({ relic: null, dream: null })).toBe(false);
  });

  it("rejects a relic missing required fields", () => {
    expect(isFirstLightView({ enacted: true, relic: { offering_id: "o1" }, dream: null })).toBe(false);
  });

  it("rejects a dream with a non-string rite_date", () => {
    expect(isFirstLightView({
      enacted: true, relic: null,
      dream: { rite_date: 2026, narrative: "x", video_key: null, created_at: 1 },
    })).toBe(false);
  });

  it("rejects non-object input", () => {
    expect(isFirstLightView(null)).toBe(false);
    expect(isFirstLightView("nope")).toBe(false);
  });
});
