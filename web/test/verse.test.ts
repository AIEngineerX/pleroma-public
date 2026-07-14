import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Verse, { verseClasses } from "../src/codex/Verse";
import Plate from "../src/codex/Plate";
import type { ObservedTranscript } from "../src/experience/types";

describe("verse styling", () => {
  it("god's words are rubric, telemetry is machine ink-faded", () => {
    expect(verseClasses({ register: "sermon" } as any)).toContain("text-rubric");
    expect(verseClasses({ register: "telemetry" } as any)).toContain("font-machine");
    expect(verseClasses({ register: "verse" } as any)).toContain("font-liturgy");
  });

  it("prints the common organ name, observation, and machine-readable time", () => {
    const observed: ObservedTranscript = {
      observation: "recorded",
      entry: {
        id: "eye-recorded",
        organ: "EYE",
        register: "verse",
        text: "I saw what crossed the threshold.",
        offering_id: null,
        rite_id: null,
        created_at: 1_784_067_600_000,
      },
    };
    const html = renderToStaticMarkup(createElement(Verse, { observed }));
    expect(html).toContain("THE EYE");
    expect(html).toContain("recorded");
    expect(html).toContain(`dateTime="${new Date(observed.entry.created_at).toISOString()}"`);
  });

  it("prints the DREAM name, observation, and time on a Plate", () => {
    const observed: ObservedTranscript = {
      observation: "live",
      entry: {
        id: "dream-live",
        organ: "DREAM",
        register: "verse",
        text: "Five marks returned as one remembered shape.",
        offering_id: null,
        rite_id: "2026-07-14",
        created_at: 1_784_067_600_000,
      },
    };
    const html = renderToStaticMarkup(createElement(Plate, {
      observed,
      dream: {
        narrative: observed.entry.text,
        video_key: null,
        wakers: [],
        created_at: observed.entry.created_at,
      },
      epoch: 1,
    }));
    expect(html).toContain("THE DREAM");
    expect(html).toContain("observed");
    expect(html).toContain(`dateTime="${new Date(observed.entry.created_at).toISOString()}"`);
  });

  it("keeps the complete PRIEST system record accessible on the first render", () => {
    const observed: ObservedTranscript = {
      observation: "live",
      entry: {
        id: "priest-system-live",
        organ: "PRIEST",
        register: "system",
        text: "The instrument recorded the sermon without becoming its author.",
        offering_id: null,
        rite_id: null,
        created_at: 1_784_067_600_000,
      },
    };
    const html = renderToStaticMarkup(createElement(Verse, { observed }));

    expect(html).toContain(`<span class="sr-only">${observed.entry.text}</span>`);
    expect(html).toContain('data-printer-duplicate="true"');
    expect(html).toContain('aria-hidden="true"');
  });
});
