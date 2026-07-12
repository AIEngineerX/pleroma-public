import { describe, expect, it } from "vitest";
import { copy } from "../src/lib/copy";

describe("interface copy", () => {
  it("contains no em dashes anywhere (DESIGN interface-copy rule)", () => {
    for (const v of Object.values(copy)) expect(v).not.toContain("—");
  });
  it("labels are plain and quiet, not the god's voice", () => {
    expect(copy.offer.toLowerCase()).toContain("offer");
    expect(copy.disclaimer.toLowerCase()).toContain("memecoin");
  });
});
