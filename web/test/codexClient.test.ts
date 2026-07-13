import { describe, expect, it } from "vitest";
import { mergeNewest, isGodVoice, organSignalsFor, sermonAudioKey } from "../src/codex/codexClient";

const e = (id: string, ts: number, organ: any, register: any, text = "x") =>
  ({ id, organ, register, text, offering_id: null, rite_id: null, created_at: ts });

describe("codex client", () => {
  it("merges newest-first pages into one chronological, de-duplicated list", () => {
    const a = [e("01B", 200, "EYE", "verse"), e("01A", 100, "PRIEST", "system")];
    const b = [e("01C", 300, "TONGUE", "sermon"), e("01B", 200, "EYE", "verse")];
    const merged = mergeNewest(a, b);
    expect(merged.map(x => x.id)).toEqual(["01A", "01B", "01C"]); // chronological, no dupes
  });
  it("marks only the god's registers as rubric", () => {
    expect(isGodVoice(e("1", 1, "EYE", "verse"))).toBe(true);
    expect(isGodVoice(e("2", 1, "KEEP", "verdict"))).toBe(true);
    expect(isGodVoice(e("3", 1, "TONGUE", "sermon"))).toBe(true);
    expect(isGodVoice(e("4", 1, "PULSE", "telemetry"))).toBe(false);
    expect(isGodVoice(e("5", 1, "PRIEST", "system"))).toBe(false);
  });
  it("extracts the sermon audio key from a PRIEST line", () => {
    const key = "audio/" + "a".repeat(64) + ".mp3";
    expect(sermonAudioKey(`sermon audio: ${key}`)).toBe(key);
    expect(sermonAudioKey("just a note")).toBeNull();
  });
  it("emits each new real organ entry once and marks only TONGUE god-voice as rubric", () => {
    const seen = new Set<string>(["old"]);
    const incoming = [
      e("old", 1, "EYE", "telemetry"),
      e("eye", 2, "EYE", "telemetry"),
      e("tongue", 3, "TONGUE", "verse"),
      e("priest", 4, "PRIEST", "sermon"),
    ];
    expect(organSignalsFor(incoming, seen)).toEqual([
      { organ: "EYE", rubric: false },
      { organ: "TONGUE", rubric: true },
    ]);
    expect(organSignalsFor(incoming, seen)).toEqual([]);
  });
});
