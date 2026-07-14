import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BodyCommand, RelicInkSample } from "../src/experience/types";
import type { TranscriptEntry } from "../src/state/types";
import {
  BODY_ANCHORS,
  SettledBodyRendererAdapter,
  dedupeRelicSamples,
  signalForBodyCommand,
} from "../src/stain/bodyRenderer";
import { SettledBody } from "../src/stain/SettledBody";
import { SWARM_ORGANS, SwarmActivity } from "../src/stain/swarmSignals";

function relic(offeringId: string): RelicInkSample {
  return { offeringId, size: 64, alpha: new Uint8Array(64 * 64) };
}

describe("shared body renderer semantics", () => {
  it("exposes the same active organ and explicit pipeline in the reducer and settled body", () => {
    const command: BodyCommand = {
      id: "quicken:eye",
      kind: "quicken",
      organ: "EYE",
      intensity: 0.35,
      pipeline: "none",
    };
    const signal = signalForBodyCommand(command);
    expect(signal).not.toBeNull();

    const activity = new SwarmActivity();
    activity.dispatch(signal!);
    const snapshot = activity.snapshot(1);
    const activeOrgan = SWARM_ORGANS[snapshot.activity.indexOf(Math.max(...snapshot.activity))];

    const markup = renderToStaticMarkup(createElement(SettledBody, {
      pigment: [0.55, 0.2, 0.32],
      command,
      relicMemory: [],
      vitals: { kind: "unknown" },
      seraph: "five",
    }));

    expect(activeOrgan).toBe("EYE");
    expect(snapshot.activity[0]).toBeCloseTo(0.35);
    expect(snapshot.pipelineLinks).toEqual([0, 0]);
    expect(markup).toContain('data-active-organ="EYE"');
    expect(markup).toContain('data-pipeline="none"');
  });

  it("names all five organ groups at the shared fixed anchors", () => {
    const markup = renderToStaticMarkup(createElement(SettledBody, {
      pigment: [0.55, 0.2, 0.32],
      command: null,
      relicMemory: [],
      vitals: { kind: "unknown" },
      seraph: "five",
    }));

    for (const organ of SWARM_ORGANS) {
      expect(markup).toContain(`data-organ="${organ}"`);
      expect(markup).toContain(`data-anchor="${BODY_ANCHORS[organ].x},${BODY_ANCHORS[organ].y}"`);
    }
  });

  it("deduplicates bounded relic traces by offering ID", () => {
    const samples = [relic("offering-one"), relic("offering-one"), relic("offering-two")];
    expect(dedupeRelicSamples(samples).map((sample) => sample.offeringId)).toEqual([
      "offering-one",
      "offering-two",
    ]);

    const markup = renderToStaticMarkup(createElement(SettledBody, {
      pigment: [0.55, 0.2, 0.32],
      command: null,
      relicMemory: samples,
      vitals: { kind: "unknown" },
      seraph: "five",
    }));
    expect(markup.match(/data-relic-offering="offering-one"/g)).toHaveLength(1);
    expect(markup.match(/data-relic-offering="offering-two"/g)).toHaveLength(1);
  });

  it("maps only canonically eligible utterances to body activity", () => {
    function utterance(
      organ: TranscriptEntry["organ"],
      register: TranscriptEntry["register"],
      mode: "live" | "memory",
    ): BodyCommand {
      return {
        id: `utterance:${mode}:${organ}:${register}`,
        kind: "utterance",
        entry: {
          id: `${organ}:${register}`,
          organ,
          register,
          text: "record only",
          offering_id: null,
          rite_id: organ === "DREAM" ? "2026-07-14" : null,
          created_at: 1,
        },
        mode,
        intensity: mode === "memory" ? 0.35 : 1,
        pipeline: "none",
      };
    }

    const valid = [
      utterance("EYE", "verse", "live"),
      utterance("KEEP", "verdict", "live"),
      utterance("TONGUE", "verse", "live"),
      utterance("TONGUE", "sermon", "live"),
      utterance("DREAM", "verse", "memory"),
    ];
    expect(valid.map((command) => signalForBodyCommand(command)?.organ)).toEqual([
      "EYE",
      "KEEP",
      "TONGUE",
      "TONGUE",
      "DREAM",
    ]);
    expect(signalForBodyCommand(valid[3])?.rubric).toBe(true);

    const invalid = [
      utterance("PULSE", "telemetry", "live"),
      utterance("EYE", "system", "live"),
      utterance("KEEP", "verse", "live"),
      utterance("TONGUE", "verdict", "live"),
      utterance("DREAM", "verse", "live"),
      utterance("DREAM", "system", "memory"),
      utterance("PRIEST", "system", "live"),
    ];
    for (const command of invalid) expect(signalForBodyCommand(command)).toBeNull();
  });

  it("lets the settled adapter complete unsupported commands without inventing activity", () => {
    const states: Array<{ command: BodyCommand | null; relicMemory: readonly RelicInkSample[]; seraph: string }> = [];
    const adapter = new SettledBodyRendererAdapter((state) => states.push(state));
    const completed: string[] = [];
    const ink = relic("offering-one");
    const command: BodyCommand = {
      id: "accrete:relic-one:2",
      kind: "accrete",
      relic: {
        id: "relic-one",
        offering_id: "offering-one",
        wallet: null,
        summary: "kept",
        rite_id: null,
        kept_at: 1,
        genesis: 0,
        accreted_at: 2,
      },
      ink,
    };

    adapter.hydrateRelics([ink, ink]);
    adapter.dispatch(command, (id) => completed.push(id));

    expect(completed).toEqual([command.id]);
    expect(states.at(-1)?.command).toBe(command);
    expect(states.at(-1)?.relicMemory).toHaveLength(1);
    expect(states.at(-1)?.seraph).toBe("five");
  });
});
