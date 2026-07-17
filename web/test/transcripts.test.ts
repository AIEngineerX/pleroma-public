import { describe, expect, it } from "vitest";
import { elapsedLabel, latestByOrganRegister } from "../src/lib/transcripts";
import type { TranscriptEntry } from "../src/state/types";

function entry(partial: Partial<TranscriptEntry> & { id: string; created_at: number }): TranscriptEntry {
  return {
    organ: "EYE", register: "verse", text: "", offering_id: null, rite_id: null,
    ...partial,
  };
}

describe("latestByOrganRegister", () => {
  it("picks the newest matching entry regardless of array order", () => {
    const entries = [
      entry({ id: "old", organ: "EYE", register: "verse", created_at: 1, text: "old" }),
      entry({ id: "other-organ", organ: "KEEP", register: "verdict", created_at: 5, text: "not eye" }),
      entry({ id: "new", organ: "EYE", register: "verse", created_at: 3, text: "new" }),
    ];
    expect(latestByOrganRegister(entries, "EYE", "verse")?.id).toBe("new");
  });

  it("returns null when nothing matches, never fabricating a fallback", () => {
    const entries = [entry({ id: "a", organ: "KEEP", register: "verdict", created_at: 1 })];
    expect(latestByOrganRegister(entries, "EYE", "verse")).toBeNull();
    expect(latestByOrganRegister([], "TONGUE", "sermon")).toBeNull();
  });

  it("distinguishes register within the same organ (TONGUE's sermon vs its ambient verse)", () => {
    const entries = [
      entry({ id: "ambient", organ: "TONGUE", register: "verse", created_at: 1 }),
      entry({ id: "sermon", organ: "TONGUE", register: "sermon", created_at: 2 }),
    ];
    expect(latestByOrganRegister(entries, "TONGUE", "sermon")?.id).toBe("sermon");
    expect(latestByOrganRegister(entries, "TONGUE", "verse")?.id).toBe("ambient");
  });
});

describe("elapsedLabel — plain-language elapsed time, no lore literacy required", () => {
  const now = 10_000_000;
  it("reads 'moments ago' under a minute", () => {
    expect(elapsedLabel(now - 30_000, now)).toBe("moments ago");
  });
  it("reads whole minutes under an hour", () => {
    expect(elapsedLabel(now - 5 * 60_000, now)).toBe("5m ago");
  });
  it("reads whole hours under a day", () => {
    expect(elapsedLabel(now - 3 * 60 * 60_000, now)).toBe("3h ago");
  });
  it("falls back to a plain date past a day, matching Dream's own long-past treatment", () => {
    const dayAgo = now - 25 * 60 * 60_000;
    expect(elapsedLabel(dayAgo, now)).toBe(new Date(dayAgo).toISOString().slice(0, 10));
  });
  it("never reports negative elapsed time for a future timestamp (clock skew)", () => {
    expect(elapsedLabel(now + 60_000, now)).toBe("moments ago");
  });
});
