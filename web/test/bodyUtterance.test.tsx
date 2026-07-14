import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import BodyUtterance, * as bodyUtteranceModule from "../src/experience/BodyUtterance";
import type { BodyCommand } from "../src/experience/types";
import type { TranscriptEntry } from "../src/state/types";

interface RepairBodyUtteranceApi {
  BODY_UTTERANCE_DEADLINE_MS: number;
  BODY_UTTERANCE_TOTAL_MS: number;
  bodyUtteranceTiming(startedAt: number, now: number, reducedMotion: boolean): {
    elapsedMs: number;
    deadlineRemainingMs: number;
    presentationComplete: boolean;
    timelineOffsetMs: number;
  };
  settlementVector(direction: "right" | "down"): { x: number; y: number };
}

const {
  BODY_UTTERANCE_DEADLINE_MS,
  BODY_UTTERANCE_TOTAL_MS,
  bodyUtteranceTiming,
  settlementVector,
} = bodyUtteranceModule as unknown as RepairBodyUtteranceApi;

const RepairBodyUtterance = BodyUtterance as ComponentType<{
  command: Extract<BodyCommand, { kind: "utterance" }> | null;
  anchor: { x: number; y: number };
  presentationStartedAt: number;
  settleDirection: "right" | "down";
  onComplete(id: string): void;
}>;

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

function renderBody(
  value: Extract<BodyCommand, { kind: "utterance" }>,
  settleDirection: "right" | "down" = "right",
): string {
  return renderToStaticMarkup(createElement(RepairBodyUtterance, {
    command: value,
    anchor: { x: 0.5, y: 0.28 },
    presentationStartedAt: 1_000,
    settleDirection,
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
    expect(BODY_UTTERANCE_DEADLINE_MS).toBeLessThanOrEqual(4_000);

    expect(bodyUtteranceTiming(1_000, 2_600, false)).toEqual({
      elapsedMs: 1_600,
      deadlineRemainingMs: BODY_UTTERANCE_DEADLINE_MS - 1_600,
      presentationComplete: false,
      timelineOffsetMs: 1_600,
    });
    expect(bodyUtteranceTiming(1_000, 5_000, false).presentationComplete).toBe(true);
    expect(bodyUtteranceTiming(1_000, 5_000, false).deadlineRemainingMs).toBe(0);
  });

  it("settles toward the actual Codex axis without moving layout properties", () => {
    expect(settlementVector("right")).toEqual({ x: 96, y: -10 });
    expect(settlementVector("down")).toEqual({ x: 0, y: 72 });
    expect(renderBody(command("live", "TONGUE", "sermon"), "right"))
      .toContain('data-settle-direction="right"');
    expect(renderBody(command("live", "TONGUE", "sermon"), "down"))
      .toContain('data-settle-direction="down"');
  });
});
