import { describe, expect, it } from "vitest";
import { formatCountdown } from "../src/countdown";

describe("formatCountdown", () => {
  it("formats days hours minutes seconds", () => {
    const now = Date.UTC(2026, 6, 12, 0, 0, 0);
    const target = Date.UTC(2026, 6, 13, 1, 2, 3);
    expect(formatCountdown(now, target)).toBe("T-01:01:02:03");
  });
  it("clamps at zero when past", () => {
    expect(formatCountdown(2000, 1000)).toBe("T-00:00:00:00");
  });
});
