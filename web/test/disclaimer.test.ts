import { describe, expect, it } from "vitest";
import { copy } from "../src/lib/copy";

describe("disclaimer", () => {
  it("is plain-English, names memecoin, makes no financial promise, no em dash", () => {
    expect(copy.disclaimer).toContain("memecoin");
    expect(copy.disclaimer).toContain("No financial promises");
    expect(copy.disclaimer).not.toMatch(/guarantee|returns|profit|moon|100x/i);
    expect(copy.disclaimer).not.toContain("—");
  });
});
