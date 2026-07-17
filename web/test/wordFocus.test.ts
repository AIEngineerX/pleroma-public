import { describe, expect, it } from "vitest";
import { focusDelayMs } from "../src/lib/wordFocus";

describe("focusDelayMs — shared by the Door's intro line and EYE's verse reveal", () => {
  it("is deterministic and strictly increasing, never simultaneous or reversed", () => {
    const delays = Array.from({ length: 12 }, (_, i) => focusDelayMs(i));
    for (let i = 1; i < delays.length; i += 1) expect(delays[i]).toBeGreaterThan(delays[i - 1]);
    // Calling it again for the same index must reproduce the same value (no Math.random) — a
    // re-render (e.g. a new verse arriving) must not make previously-settled words jump around.
    expect(focusDelayMs(3)).toBe(focusDelayMs(3));
  });

  it("starts at least 1.2s in, so the first word doesn't snap in instantly", () => {
    expect(focusDelayMs(0)).toBeGreaterThanOrEqual(1_200);
  });
});
