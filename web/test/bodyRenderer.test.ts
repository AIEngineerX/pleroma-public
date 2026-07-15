import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BodyCommand, RelicInkSample } from "../src/experience/types";
import type { TranscriptEntry } from "../src/state/types";
import {
  BODY_ANCHORS,
  SettledBodyRendererAdapter,
  anchorForSlice,
  dedupeRelicSamples,
  signalForBodyCommand,
  type SettledBodyRendererState,
} from "../src/stain/bodyRenderer";
import { SettledBody } from "../src/stain/SettledBody";
import { SWARM_ORGANS, SwarmActivity } from "../src/stain/swarmSignals";

function relic(offeringId: string): RelicInkSample {
  const alpha = new Uint8Array(64 * 64);
  for (let index = 8; index < 56; index += 1) {
    alpha[index * 64 + 12] = 180;
    alpha[48 * 64 + index] = 180;
  }
  return { offeringId, size: 64, alpha };
}

describe("shared body renderer semantics", () => {
  it("maps SVG slice anchors into the visible overlay coordinates", () => {
    expect(anchorForSlice(BODY_ANCHORS.EYE, 200, 100)).toEqual({ x: 0.5, y: 0.06 });
    expect(anchorForSlice(BODY_ANCHORS.KEEP, 100, 200)).toEqual({ x: 0.9, y: 0.43 });
    expect(anchorForSlice(BODY_ANCHORS.TONGUE, 100, 100)).toEqual(BODY_ANCHORS.TONGUE);
  });

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
    expect(markup.match(/data-relic-fragment/g)).toHaveLength(2);
  });

  it("renders only nonempty deterministic dried fragments and caps the settled memory at fifty", () => {
    const samples = Array.from({ length: 52 }, (_, index) => relic(`offering-${index}`));
    const empty: RelicInkSample = {
      offeringId: "empty-offering",
      size: 64,
      alpha: new Uint8Array(64 * 64),
    };
    const markup = renderToStaticMarkup(createElement(SettledBody, {
      pigment: [0.55, 0.2, 0.32],
      command: null,
      relicMemory: [...samples, empty],
      vitals: { kind: "unknown" },
      seraph: "five",
      relicRevision: 7,
      activeAccretionKey: null,
    }));

    expect(markup.match(/data-relic-fragment/g)).toHaveLength(50);
    expect(markup).not.toContain('data-relic-offering="offering-50"');
    expect(markup).not.toContain('data-relic-offering="empty-offering"');
    expect(markup).toContain('data-relic-count="50"');
    expect(markup).toContain('data-relic-revision="7"');
    expect(markup).not.toContain("data-accretion-active-key");
  });

  it("starts SVG relic travel at the same centered lower threshold as WebGL", () => {
    const ink = relic("centered-offering");
    const command: BodyCommand = {
      id: "accrete:centered-relic:9",
      kind: "accrete",
      relic: {
        id: "centered-relic",
        offering_id: ink.offeringId,
        wallet: null,
        summary: "centered threshold",
        rite_id: null,
        kept_at: 8,
        genesis: 0,
        accreted_at: 9,
      },
      ink,
    };
    const markup = renderToStaticMarkup(createElement(SettledBody, {
      pigment: [0.55, 0.2, 0.32],
      command,
      relicMemory: [],
      vitals: { kind: "unknown" },
      seraph: "five",
      activeAccretionKey: "centered-offering\u001f9",
    }));

    expect(markup).toContain('data-relic-travel-start="50,93"');
    expect(markup).toContain('data-relic-travel-scale="0.16"');
    expect(markup).toContain('from="0 43"');
    expect(markup).not.toContain('from="-34 28"');
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

    const rememberedSermon = signalForBodyCommand(utterance("TONGUE", "sermon", "memory"));
    expect(rememberedSermon).not.toBeNull();
    expect(rememberedSermon?.rubric).not.toBe(true);

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

  it("holds ordinary SVG accretion for 1.2 seconds, then commits and completes exactly once", async () => {
    const states: SettledBodyRendererState[] = [];
    const adapter = new SettledBodyRendererAdapter((state) => states.push(state), false);
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

    adapter.dispatch(command, (id) => completed.push(id));

    expect(completed).toEqual([]);
    expect(states.at(-1)?.command).toBe(command);
    expect(states.at(-1)?.relicMemory).toHaveLength(0);
    expect(states.at(-1)?.activeAccretionKey).toBe("offering-one\u001f2");
    expect(states.at(-1)?.seraph).toBe("five");

    await new Promise((resolve) => setTimeout(resolve, 1_250));
    expect(completed).toEqual([command.id]);
    expect(states.at(-1)?.relicMemory).toEqual([ink]);
    expect(states.at(-1)?.activeAccretionKey).toBeNull();
    expect(states.at(-1)?.relicRevision).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(completed).toEqual([command.id]);
    adapter.dispose();
  });

  it("commits reduced-motion accretion immediately without a travel marker", () => {
    const states: SettledBodyRendererState[] = [];
    const adapter = new SettledBodyRendererAdapter((state) => states.push(state), true);
    const ink = relic("reduced-offering");
    const command: BodyCommand = {
      id: "accrete:reduced-relic:5",
      kind: "accrete",
      relic: {
        id: "reduced-relic",
        offering_id: ink.offeringId,
        wallet: null,
        summary: "kept",
        rite_id: null,
        kept_at: 4,
        genesis: 0,
        accreted_at: 5,
      },
      ink,
    };
    const completed: string[] = [];
    adapter.dispatch(command, (id) => completed.push(id));
    expect(completed).toEqual([command.id]);
    expect(states.at(-1)?.activeAccretionKey).toBeNull();
    expect(states.at(-1)?.relicMemory).toEqual([ink]);
    adapter.dispose();
  });
});
