import { describe, expect, it } from "vitest";
import { withTimeout, TimeoutError } from "../src/timeouts";

describe("withTimeout", () => {
  it("resolves a fast operation and passes an abort signal", async () => {
    const r = await withTimeout("fast", 1000, async (signal) => { expect(signal.aborted).toBe(false); return 42; });
    expect(r).toBe(42);
  });
  it("rejects a slow operation with TimeoutError", async () => {
    await expect(withTimeout("slow", 20, (signal) =>
      new Promise((_, rej) => signal.addEventListener("abort", () => rej(new TimeoutError("slow")))))).rejects.toBeInstanceOf(TimeoutError);
  });
});
