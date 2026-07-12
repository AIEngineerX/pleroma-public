import { describe, expect, it } from "vitest";
import { verseClasses } from "../src/codex/Verse";

describe("verse styling", () => {
  it("god's words are rubric, telemetry is machine ink-faded", () => {
    expect(verseClasses({ register: "sermon" } as any)).toContain("text-rubric");
    expect(verseClasses({ register: "telemetry" } as any)).toContain("font-machine");
    expect(verseClasses({ register: "verse" } as any)).toContain("font-liturgy");
  });
});
