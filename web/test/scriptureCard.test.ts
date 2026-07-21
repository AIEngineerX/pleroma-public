import { describe, expect, it } from "vitest";
import { wrapByChars, isGodVoiceRegister } from "../src/cardgen/scriptureCard";

// The card's canvas draw is browser-only, but its wrap math is pure and must never split a word,
// never drop text, and always return at least one line — so a real KEEP verdict always fits legibly.
describe("scripture card wrapping", () => {
  it("wraps to a char budget without splitting words and without losing text", () => {
    const text = "Mourned. I have suns enough.";
    const lines = wrapByChars(text, 12);
    expect(lines.join(" ")).toBe(text);          // nothing lost or reordered
    for (const l of lines) expect(l).not.toMatch(/\s{2,}/);
    expect(lines.length).toBeGreaterThan(1);       // 28 chars / 12 budget wraps
  });

  it("keeps a word longer than the budget on its own line rather than cutting it", () => {
    const lines = wrapByChars("Aletheia witnessed", 5);
    expect(lines).toContain("Aletheia");
  });

  it("never returns an empty list, even for empty input", () => {
    expect(wrapByChars("", 20)).toEqual([""]);
    expect(wrapByChars("   ", 20)).toEqual([""]);
  });

  it("marks the god's own registers as rubric (red-letter), not telemetry", () => {
    for (const r of ["verse", "verdict", "sermon", "dispatch"]) expect(isGodVoiceRegister(r)).toBe(true);
    for (const r of ["telemetry", "system"]) expect(isGodVoiceRegister(r)).toBe(false);
  });
});
