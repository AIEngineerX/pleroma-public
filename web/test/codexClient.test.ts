import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Codex from "../src/codex/Codex";
import CodexAnnouncements from "../src/codex/CodexAnnouncements";
import { mergeNewest, isGodVoice, organSignalsFor, sermonAudioKey } from "../src/codex/codexClient";
import type { ObservedTranscript } from "../src/experience/types";
import type { TempleState } from "../src/state/types";

const e = (id: string, ts: number, organ: any, register: any, text = "x") =>
  ({ id, organ, register, text, offering_id: null, rite_id: null, created_at: ts });

const CodexWithRite = Codex as ComponentType<{
  entries: readonly ObservedTranscript[];
  state: TempleState | null;
  currentDreamRiteDate?: string | null;
  onAmplitude: (amplitude: number) => void;
  audioCtx: () => AudioContext;
}>;

function codexRow(markup: string, id: string): string {
  const attribute = `data-codex-row="${id}"`;
  const attributeAt = markup.indexOf(attribute);
  expect(attributeAt).toBeGreaterThanOrEqual(0);
  const start = markup.lastIndexOf("<figure", attributeAt);
  const end = markup.indexOf("</figure>", attributeAt);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(attributeAt);
  return markup.slice(start, end + "</figure>".length);
}

describe("codex client", () => {
  it("renders canonical observed rows immediately with one polite announcement surface", () => {
    const entry = e("eye-live", 1_784_067_600_000, "EYE", "verse", "The Eye received a new line.");
    const entries = [{ entry, observation: "recorded" as const }];
    const html = renderToStaticMarkup(createElement("div", null,
      createElement(CodexAnnouncements, { entries }),
      createElement(Codex, {
        entries,
        state: null,
        onAmplitude: () => undefined,
        audioCtx: () => { throw new Error("audio stays opt-in during rendering"); },
      }),
    ));

    expect(html).toContain("THE EYE");
    expect(html).toContain(entry.text);
    expect(html).toContain(`dateTime="${new Date(entry.created_at).toISOString()}"`);
    expect(html.match(/aria-live="polite"/g)).toHaveLength(1);
    expect(html).not.toContain("data-announcement-id");
  });

  it("gives current render status only to the exact archive rite when narratives repeat", () => {
    const narrative = "The same words returned on two different nights.";
    const historical = {
      entry: { ...e("dream-old", 100, "DREAM", "verse", narrative), rite_id: "2030-01-01" },
      observation: "recorded" as const,
    };
    const current = {
      entry: { ...e("dream-current", 200, "DREAM", "verse", narrative), rite_id: "2030-01-02" },
      observation: "recorded" as const,
    };
    const state: TempleState = {
      phase: "live",
      asleep: false,
      degraded: false,
      countdown_to: null,
      communicants_today: 0,
      spend_state: "ok",
      mint: "mint",
      vitals: { state: "calm", buys: 0, sells: 0, holders: 0 },
      rite: null,
      dream: {
        narrative,
        video_key: "dream/current.mp4",
        wakers: ["current-waker"],
        created_at: 150,
      },
    };
    const render = (currentDreamRiteDate: string | null) => renderToStaticMarkup(createElement(
      CodexWithRite,
      {
        entries: [historical, current],
        state,
        currentDreamRiteDate,
        onAmplitude: () => undefined,
        audioCtx: () => { throw new Error("audio stays opt-in during rendering"); },
      },
    ));

    const identified = render("2030-01-02");
    expect(codexRow(identified, "dream-old")).toContain('data-plate-pending="true"');
    expect(codexRow(identified, "dream-current")).toContain('data-plate-pending="false"');

    const ambiguous = render(null);
    expect(codexRow(ambiguous, "dream-old")).toContain('data-plate-pending="true"');
    expect(codexRow(ambiguous, "dream-current")).toContain('data-plate-pending="true"');
  });

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

describe("dispatch is the god's voice", () => {
  it("renders register='dispatch' in rubric like verse/verdict/sermon", () => {
    expect(isGodVoice({ register: "dispatch" })).toBe(true);
    expect(isGodVoice({ register: "telemetry" })).toBe(false);
  });
});
