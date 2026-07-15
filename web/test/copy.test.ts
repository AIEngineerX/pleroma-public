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

  it("has factual printed-document labels for the evidence flow", () => {
    const labels = copy as Record<string, string>;
    expect(labels.codex).toBe("The Codex");
    expect(labels.reliquary).toBe("The Reliquary");
    expect(labels.tallies).toBe("The Tallies");
    expect(labels.sermonRecorded).toBe("sermon recorded");
  });
});
