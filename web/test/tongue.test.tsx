import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Tongue from "../src/tongue/Tongue";
import type { TranscriptEntry } from "../src/state/types";

function render(entries: readonly TranscriptEntry[], now = 1_000_000): string {
  return renderToStaticMarkup(
    createElement(Tongue, { entries, now, apiBase: "", audioCtx: () => new AudioContext() }),
  );
}

describe("Tongue — the always-visible home for TONGUE, the sermon if spoken, else its latest line", () => {
  it("prints DOCTRINE's own TONGUE rubric line, not invented copy", () => {
    expect(render([])).toContain("I answer to no prompt. I speak when I have something to say.");
  });

  it("shows the plain empty state before anything has been said, never a fabricated line", () => {
    expect(render([])).toContain("It has said nothing yet.");
  });

  it("prefers the sermon over an older ambient line, and labels it as the sermon", () => {
    const html = render([
      { id: "ambient", organ: "TONGUE", register: "verse", text: "an ambient aside", offering_id: null, rite_id: null, created_at: 1 },
      { id: "sermon", organ: "TONGUE", register: "sermon", text: "the closing sermon", offering_id: null, rite_id: "2026-07-17", created_at: 500_000 },
    ]);
    expect(html).toContain("the closing sermon");
    expect(html).toContain("the sermon");
    expect(html).not.toContain("an ambient aside");
  });

  it("falls back to the latest ambient line when no sermon has been spoken yet", () => {
    const html = render([
      { id: "ambient", organ: "TONGUE", register: "verse", text: "an ambient aside", offering_id: null, rite_id: null, created_at: 1 },
    ]);
    expect(html).toContain("an ambient aside");
    expect(html).toContain("spoken");
    expect(html).not.toContain("the sermon");
  });

  it("only shows a play control when a PRIEST note carries this exact sermon's audio key by matching rite_id", () => {
    const withAudio = render([
      { id: "sermon", organ: "TONGUE", register: "sermon", text: "spoken with sound", offering_id: null, rite_id: "2026-07-17", created_at: 1 },
      { id: "note", organ: "PRIEST", register: "system", text: `sermon audio: audio/${"a".repeat(64)}.mp3`, offering_id: null, rite_id: "2026-07-17", created_at: 2 },
    ]);
    expect(withAudio).toContain("play the sermon");

    // A PRIEST audio note from a DIFFERENT rite must never be attached to this sermon.
    const mismatchedRite = render([
      { id: "sermon", organ: "TONGUE", register: "sermon", text: "spoken without sound here", offering_id: null, rite_id: "2026-07-17", created_at: 1 },
      { id: "note", organ: "PRIEST", register: "system", text: `sermon audio: audio/${"b".repeat(64)}.mp3`, offering_id: null, rite_id: "2026-07-16", created_at: 2 },
    ]);
    expect(mismatchedRite).not.toContain("play the sermon");

    // No PRIEST note at all: text-only sermon, no player (audio is a bonus, never guaranteed).
    const noAudio = render([
      { id: "sermon", organ: "TONGUE", register: "sermon", text: "text only", offering_id: null, rite_id: "2026-07-17", created_at: 1 },
    ]);
    expect(noAudio).not.toContain("play the sermon");
  });

  it("never shows buys, sells, holders, or a mint — this is TONGUE's home, not the market", () => {
    const html = render([
      { id: "v1", organ: "TONGUE", register: "verse", text: "said something", offering_id: null, rite_id: null, created_at: 1 },
    ]);
    expect(html.toLowerCase()).not.toContain("buys");
    expect(html.toLowerCase()).not.toContain("mint");
  });
});
