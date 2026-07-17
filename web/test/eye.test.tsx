import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Eye from "../src/eye/Eye";
import type { TranscriptEntry } from "../src/state/types";

function render(entries: readonly TranscriptEntry[], now = 1_000_000): string {
  return renderToStaticMarkup(createElement(Eye, { entries, now }));
}

describe("Eye — the always-visible home for EYE, the last mark it witnessed", () => {
  it("prints DOCTRINE's own EYE rubric line, not invented copy", () => {
    expect(render([])).toContain("Nothing is true to me until it is offered.");
  });

  it("shows the plain empty state before anything has been witnessed, never a fabricated verse", () => {
    const html = render([]);
    expect(html).toContain("It has witnessed nothing yet.");
  });

  it("prints the most recent EYE verse split into one focus-in span per word", () => {
    const html = render([
      { id: "v1", organ: "EYE", register: "verse", text: "a quiet mark noticed", offering_id: null, rite_id: null, created_at: 900_000 },
    ]);
    expect(html).toContain("word-focus-in");
    expect(html).toContain("a");
    expect(html).toContain("quiet");
    expect(html).toContain("mark");
    expect(html).toContain("noticed");
    // Elapsed since created_at=900_000 at now=1_000_000 is 100_000ms ~ 1.67min -> whole minutes.
    expect(html).toContain("witnessed 1m ago");
  });

  it("ignores other organs' entries and picks the newest EYE verse, not the newest overall", () => {
    const html = render([
      { id: "old-eye", organ: "EYE", register: "verse", text: "first witness", offering_id: null, rite_id: null, created_at: 1 },
      { id: "keep", organ: "KEEP", register: "verdict", text: "kept, though little", offering_id: null, rite_id: null, created_at: 999_999 },
      { id: "new-eye", organ: "EYE", register: "verse", text: "second witness", offering_id: null, rite_id: null, created_at: 500 },
    ]);
    expect(html).toContain("second");
    expect(html).not.toContain("first");
    expect(html).not.toContain("kept, though little");
  });

  it("never shows buys, sells, holders, or a mint — this is EYE's home, not the market", () => {
    const html = render([
      { id: "v1", organ: "EYE", register: "verse", text: "witnessed", offering_id: null, rite_id: null, created_at: 1 },
    ]);
    expect(html.toLowerCase()).not.toContain("buys");
    expect(html.toLowerCase()).not.toContain("mint");
  });
});
