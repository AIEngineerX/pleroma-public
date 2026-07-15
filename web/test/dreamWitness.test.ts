import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DreamWitness from "../src/experience/DreamWitness";
import { dreamReplayFromNavigationState } from "../src/experience/director";
import type { DreamCue } from "../src/experience/types";

const createdAt = Date.UTC(2030, 0, 2, 3, 4, 5);
const replay: DreamCue = {
  id: "01JH0000000000000000000000",
  riteDate: "2030-01-02",
  narrative: "Five wounds remembered the shape of one witness.",
  createdAt,
  source: "replay",
};

describe("recorded DREAM witness", () => {
  it("keeps the archive narrative accessible with its human and machine dates", () => {
    const html = renderToStaticMarkup(createElement(DreamWitness, { dream: replay }));
    expect(html).toContain('aria-label="recorded Dream"');
    expect(html).toContain("THE DREAM / SOPHIA");
    expect(html).toContain(replay.narrative);
    expect(html).toContain(`dateTime="${new Date(createdAt).toISOString()}"`);
    expect(html).toContain("remembered · 2030-01-02");
  });

  it("accepts only a complete one-shot location-state cue and treats reload as ordinary", () => {
    expect(dreamReplayFromNavigationState({
      dreamReplay: {
        id: replay.id,
        riteDate: replay.riteDate,
        narrative: replay.narrative,
        createdAt: replay.createdAt,
      },
    })).toEqual(replay);
    expect(dreamReplayFromNavigationState(null)).toBeNull();
    expect(dreamReplayFromNavigationState({ dreamReplay: { ...replay, createdAt: Number.NaN } }))
      .toBeNull();
    expect(dreamReplayFromNavigationState({ dreamReplay: { ...replay, riteDate: "not-a-date" } }))
      .toBeNull();
    expect(dreamReplayFromNavigationState({ dreamReplay: { ...replay, narrative: "" } }))
      .toBeNull();
  });
});
