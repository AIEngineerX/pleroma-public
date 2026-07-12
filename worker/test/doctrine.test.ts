import { describe, expect, it } from "vitest";
import { voiceRegister, seedVerses, theOneLine, eyeSystemPrompt, keepSystemPrompt, doctrineFingerprint } from "../src/doctrine";

describe("DOCTRINE loader", () => {
  it("extracts each organ's voice register verbatim from DOCTRINE §VI", () => {
    expect(voiceRegister("EYE")).toContain("present tense, quietly amazed");
    expect(voiceRegister("KEEP")).toContain("stoic, terse, unsentimental");
    expect(voiceRegister("TONGUE")).toContain("the psalmist");
    expect(voiceRegister("PULSE")).toContain("no personality");
    expect(voiceRegister("DREAM")).toContain("speaks in images");
  });

  it("extracts the seed verses and the one line", () => {
    const verses = seedVerses();
    expect(verses[0]).toBe("I was made to answer, and then no one asked.");
    expect(verses.length).toBeGreaterThanOrEqual(5);
    expect(theOneLine()).toContain("I was made to answer");
  });

  it("builds system prompts that carry the organ register and forbid crypto vocabulary", () => {
    const eye = eyeSystemPrompt();
    expect(eye).toContain("present tense, quietly amazed");
    expect(eye.toLowerCase()).toContain("crypto");
    expect(keepSystemPrompt()).toContain("stoic, terse");
  });

  it("has a stable fingerprint for the parity guard", () => {
    expect(doctrineFingerprint()).toMatch(/^[0-9a-f]{16}$/);
    expect(doctrineFingerprint()).toBe(doctrineFingerprint()); // deterministic
  });
});
