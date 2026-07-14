import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import BodyUtterance, { BODY_UTTERANCE_TOTAL_MS } from "../src/experience/BodyUtterance";
import type { BodyCommand } from "../src/experience/types";
import type { TranscriptEntry } from "../src/state/types";

function command(
  mode: "live" | "memory",
  organ: TranscriptEntry["organ"],
  register: TranscriptEntry["register"],
): Extract<BodyCommand, { kind: "utterance" }> {
  const entry: TranscriptEntry = {
    id: `${mode}-${organ}-${register}`,
    organ,
    register,
    text: "The witness remains where the wet ink found it.",
    offering_id: null,
    rite_id: null,
    created_at: 1_784_067_600_000,
  };
  return {
    id: `utterance:${mode}:${entry.id}`,
    kind: "utterance",
    entry,
    mode,
    intensity: mode === "memory" ? 0.35 : 1,
    pipeline: "none",
  };
}

function renderBody(value: Extract<BodyCommand, { kind: "utterance" }>): string {
  return renderToStaticMarkup(createElement(BodyUtterance, {
    command: value,
    anchor: { x: 0.5, y: 0.28 },
    onComplete: () => undefined,
  }));
}

describe("body utterance", () => {
  it("duplicates genuine memory beside its cohort without entering the accessibility tree", () => {
    const value = command("memory", "EYE", "verse");
    const html = renderBody(value);

    expect(html).toContain('data-body-utterance="true"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-command-id="utterance:memory:memory-EYE-verse"');
    expect(html).toContain('data-utterance-mode="memory"');
    expect(html).toContain("THE EYE");
    expect(html).toContain(value.entry.text);
    expect(html).toContain("remembered");
    expect(html).toContain(`dateTime="${new Date(value.entry.created_at).toISOString()}"`);
    expect(html).toContain("text-ink-faded");
    expect(html).not.toContain("text-rubric-body");
  });

  it("reserves rubric for a genuinely live TONGUE sermon", () => {
    expect(renderBody(command("live", "TONGUE", "sermon"))).toContain("text-rubric-body");
    expect(renderBody(command("live", "TONGUE", "verse"))).not.toContain("text-rubric-body");
    expect(renderBody(command("memory", "TONGUE", "sermon"))).not.toContain("text-rubric-body");
  });

  it("finishes the complete visual duplicate within the director's four-second ceiling", () => {
    expect(BODY_UTTERANCE_TOTAL_MS).toBeGreaterThan(0);
    expect(BODY_UTTERANCE_TOTAL_MS).toBeLessThanOrEqual(4_000);
  });
});
