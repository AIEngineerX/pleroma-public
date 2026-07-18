import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import Codex from "../src/codex/Codex";
import type { ObservedTranscript } from "../src/experience/types";
import type { TranscriptEntry } from "../src/state/types";

function entry(id: string, text: string, created_at: number): ObservedTranscript {
  const e: TranscriptEntry = {
    id, organ: "EYE", register: "verse", text, offering_id: null, rite_id: null, created_at,
  };
  return { entry: e, observation: "recorded" };
}

function render(entries: ObservedTranscript[], limit?: number): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(Codex, {
        entries, state: null, onAmplitude: () => undefined,
        audioCtx: () => { throw new Error("not exercised in this render"); },
        limit,
      }),
    ),
  );
}

describe("Codex — the homepage teaser vs. the full archive", () => {
  it("renders every entry when no limit is given", () => {
    const entries = [entry("a", "first witness", 1), entry("b", "second witness", 2), entry("c", "third witness", 3)];
    const html = render(entries);
    expect(html).toContain("first witness");
    expect(html).toContain("second witness");
    expect(html).toContain("third witness");
  });

  it("shows only the most recent `limit` entries (entries arrive oldest-first)", () => {
    const entries = [entry("a", "oldest witness", 1), entry("b", "middle witness", 2), entry("c", "newest witness", 3)];
    const html = render(entries, 2);
    expect(html).not.toContain("oldest witness");
    expect(html).toContain("middle witness");
    expect(html).toContain("newest witness");
  });

  it("links to the full diary only once a limit is actually applied and there's something to read", () => {
    const entries = [entry("a", "a witness", 1)];
    expect(render(entries)).not.toContain("read the full diary");
    expect(render(entries, 8)).toContain("read the full diary");
    expect(render([], 8)).not.toContain("read the full diary");
  });
});
