import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BodyCommand, RelicInkSample } from "../src/experience/types";
import type { TranscriptEntry } from "../src/state/types";
import * as bodyRendererModule from "../src/stain/bodyRenderer";
import {
  BODY_ANCHORS,
  SETTLED_SERAPH_HOLD_MS,
  SettledBodyRendererAdapter,
  anchorForYMaxMeet,
  dedupeRelicSamples,
  signalForBodyCommand,
  settledSeraphFrame,
  type SettledBodyRendererState,
} from "../src/stain/bodyRenderer";
import { SettledBody } from "../src/stain/SettledBody";
import { SWARM_ORGANS, SwarmActivity } from "../src/stain/swarmSignals";

interface DispatchOwnershipContract {
  claim(adapter: object, commandId: string): number | null;
  invalidate(): number;
  isCurrent(adapter: object, commandId: string, generation: number): boolean;
}

interface RepairBodyRendererApi {
  BodyDispatchOwnership?: new () => DispatchOwnershipContract;
  settledSeraphHoldElapsed?(webglElapsedMs: number): number;
  projectBodyAnchorsForYMaxMeet?(
    start: { x: number; y: number },
    target: { x: number; y: number },
    width: number,
    height: number,
  ): { start: { x: number; y: number }; target: { x: number; y: number } };
}

const repairApi = bodyRendererModule as unknown as RepairBodyRendererApi;

function relic(offeringId: string): RelicInkSample {
  const alpha = new Uint8Array(64 * 64);
  for (let index = 8; index < 56; index += 1) {
    alpha[index * 64 + 12] = 180;
    alpha[48 * 64 + index] = 180;
  }
  return { offeringId, size: 64, alpha };
}

describe("shared body renderer semantics", () => {
  it("maps SVG bottom-meet anchors into the visible overlay coordinates", () => {
    expect(anchorForYMaxMeet(BODY_ANCHORS.DREAM, 200, 100)).toEqual({ x: 0.4, y: 0.43 });
    expect(anchorForYMaxMeet(BODY_ANCHORS.KEEP, 100, 200)).toEqual({ x: 0.7, y: 0.715 });
    expect(anchorForYMaxMeet(BODY_ANCHORS.TONGUE, 100, 100)).toEqual(BODY_ANCHORS.TONGUE);
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

  it("uses the checked-in fivefold mask as the exclusive settled Seraph posture", () => {
    const markup = renderToStaticMarkup(createElement(SettledBody, {
      pigment: [0.55, 0.2, 0.32],
      command: null,
      relicMemory: [],
      vitals: { kind: "unknown" },
      seraph: "converged",
    }));

    expect(markup).toContain('data-seraph-mask="true"');
    for (const group of ["eye", "keep", "tongue", "pulse", "dream"]) {
      expect(markup).toContain(`id="seraph-${group}"`);
    }
    expect(markup).not.toContain("data-organ=");
  });

  it("switches settled renderers immediately for one six-second readable witness", () => {
    expect(SETTLED_SERAPH_HOLD_MS).toBe(6_000);
    expect(settledSeraphFrame(0)).toEqual({ seraph: "converged", complete: false });
    expect(settledSeraphFrame(5_999)).toEqual({ seraph: "converged", complete: false });
    expect(settledSeraphFrame(6_000)).toEqual({ seraph: "five", complete: true });
  });

  it("translates WebGL convergence elapsed into only the settled hold elapsed", () => {
    expect(typeof repairApi.settledSeraphHoldElapsed).toBe("function");
    if (repairApi.settledSeraphHoldElapsed === undefined) return;

    expect(repairApi.settledSeraphHoldElapsed(1_000)).toBe(0);
    expect(repairApi.settledSeraphHoldElapsed(5_000)).toBe(3_200);
    expect(repairApi.settledSeraphHoldElapsed(6_500)).toBe(4_700);
    expect(repairApi.settledSeraphHoldElapsed(7_799)).toBe(5_999);
    expect(repairApi.settledSeraphHoldElapsed(7_800)).toBe(6_000);
    expect(repairApi.settledSeraphHoldElapsed(10_000)).toBe(6_000);
  });

  it("projects both the SVG Dream origin and Seraph target through xMidYMax meet", () => {
    expect(typeof repairApi.projectBodyAnchorsForYMaxMeet).toBe("function");
    if (repairApi.projectBodyAnchorsForYMaxMeet === undefined) return;

    const wide = repairApi.projectBodyAnchorsForYMaxMeet(
      BODY_ANCHORS.DREAM,
      BODY_ANCHORS.seraph,
      200,
      100,
    );
    expect(wide).toEqual({
      start: { x: 0.4, y: 0.43 },
      target: { x: 0.5, y: 0.5 },
    });
    expect(wide.target.x * 200).toBe(100);
    expect(wide.start.x * 200 + (BODY_ANCHORS.seraph.x - BODY_ANCHORS.DREAM.x) * 200)
      .toBe(120);
    expect(wide.target.x * 200).not.toBe(120);

    const portrait = repairApi.projectBodyAnchorsForYMaxMeet(
      BODY_ANCHORS.DREAM,
      BODY_ANCHORS.seraph,
      100,
      200,
    );
    expect(portrait).toEqual({
      start: { x: 0.3, y: 0.715 },
      target: { x: 0.5, y: 0.75 },
    });
    expect(portrait.target.y * 200).toBe(150);
  });

  it.each(["converge", "accrete"] as const)(
    "owns install and effect dispatch once for %s and completes the current generation",
    (kind) => {
      expect(typeof repairApi.BodyDispatchOwnership).toBe("function");
      if (repairApi.BodyDispatchOwnership === undefined) return;

      const states: SettledBodyRendererState[] = [];
      const adapter = new SettledBodyRendererAdapter((state) => states.push(state), true);
      const ownership = new repairApi.BodyDispatchOwnership();
      const completions: string[] = [];
      let directorLocked = true;
      const command: BodyCommand = kind === "converge" ? {
        id: "converge:single-owner",
        kind: "converge",
        dream: {
          id: "single-owner",
          riteDate: "2030-01-02",
          narrative: "One callback carries the whole witness.",
          createdAt: 1,
          source: "live",
        },
      } : {
        id: "accrete:single-owner:2",
        kind: "accrete",
        relic: {
          id: "single-owner",
          offering_id: "single-owner-offering",
          wallet: null,
          summary: "one retained mark",
          rite_id: null,
          kept_at: 1,
          genesis: 0,
          accreted_at: 2,
        },
        ink: relic("single-owner-offering"),
      };

      const dispatchLikeStain = () => {
        const generation = ownership.claim(adapter, command.id);
        if (generation === null) return;
        adapter.dispatch(command, (id) => {
          if (!ownership.isCurrent(adapter, id, generation)) return;
          directorLocked = false;
          completions.push(id);
        }, kind === "converge" ? performance.now() - SETTLED_SERAPH_HOLD_MS : performance.now());
      };

      dispatchLikeStain(); // asynchronous install path
      dispatchLikeStain(); // React active-command effect for the same adapter + command

      expect(directorLocked).toBe(false);
      expect(completions).toEqual([command.id]);
      if (kind === "converge") {
        expect(states.at(-1)?.seraphSequenceCount).toBe(1);
      } else {
        expect(states.at(-1)?.relicRevision).toBe(1);
        expect(states.at(-1)?.relicMemory).toHaveLength(1);
      }
      adapter.dispose();
    },
  );

  it("carries elapsed convergence into fallback and completes that sequence once", () => {
    const states: SettledBodyRendererState[] = [];
    const completed: string[] = [];
    const adapter = new SettledBodyRendererAdapter((state) => states.push(state), false);
    const command: Extract<BodyCommand, { kind: "converge" }> = {
      id: "converge:replay:recorded:1",
      kind: "converge",
      dream: {
        id: "recorded",
        riteDate: "2030-01-02",
        narrative: "The old witness returns once.",
        createdAt: 1,
        source: "replay",
      },
    };
    adapter.dispatch(command, (id) => completed.push(id), performance.now() - 6_001);
    expect(completed).toEqual([command.id]);
    expect(states.at(-1)?.seraph).toBe("five");
    expect(states.at(-1)?.seraphSequenceCount).toBe(1);
    adapter.dispose();
  });

  it("returns from settled convergence with visible Sophia residue without changing PULSE truth", () => {
    const states: SettledBodyRendererState[] = [];
    const adapter = new SettledBodyRendererAdapter((state) => states.push(state), false);
    const command: Extract<BodyCommand, { kind: "converge" }> = {
      id: "converge:residue",
      kind: "converge",
      dream: {
        id: "residue",
        riteDate: "2030-01-02",
        narrative: "Sophia remains as a changed Dream organ.",
        createdAt: 1,
        source: "live",
      },
    };
    adapter.setVitals({
      kind: "current",
      value: { state: "fed", buys: 5, sells: 2, holders: 19 },
      receivedAt: 20,
    });
    adapter.dispatch(command, () => undefined, performance.now() - SETTLED_SERAPH_HOLD_MS);
    const state = states.at(-1) as (SettledBodyRendererState & { dreamResidue?: boolean }) | undefined;
    expect(state?.dreamResidue).toBe(true);

    const markup = renderToStaticMarkup(createElement(SettledBody as unknown as React.ComponentType<{
      pigment: [number, number, number];
      command: BodyCommand | null;
      relicMemory: readonly RelicInkSample[];
      vitals: SettledBodyRendererState["vitals"];
      seraph: "five" | "converged";
      dreamResidue: boolean;
    }>, {
      pigment: [0.55, 0.2, 0.32],
      command: state?.command ?? null,
      relicMemory: state?.relicMemory ?? [],
      vitals: state?.vitals ?? { kind: "unknown" },
      seraph: state?.seraph ?? "five",
      dreamResidue: state?.dreamResidue ?? false,
    }));
    expect(markup).toContain('data-dream-residue="sophia"');
    expect(markup).toContain('data-residue="sophia"');
    expect(markup).toContain('data-pulse-kind="current"');
    adapter.dispose();
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
    expect(markup).toContain('preserveAspectRatio="xMidYMax meet"');

    const projectThreshold = (width: number, height: number) => {
      const scale = Math.min(width, height) / 100;
      return {
        x: (width - 100 * scale) / 2 + 50 * scale,
        y: height - 100 * scale + 93 * scale,
      };
    };
    for (const [width, height] of [[1_600, 900], [390, 844]]) {
      const point = projectThreshold(width, height);
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(width);
      expect(point.y).toBeGreaterThan(height / 2);
      expect(point.y).toBeLessThanOrEqual(height);
    }
  });

  it("replaces same-offering alpha on command commit and authoritative hydration", () => {
    const preceding = relic("preceding-offering");
    const older = relic("timestamped-offering");
    older.alpha.fill(40);
    const newer = relic("timestamped-offering");
    newer.alpha.fill(180);
    const authoritative = relic("timestamped-offering");
    authoritative.alpha.fill(230);
    expect.soft(dedupeRelicSamples([older, newer])[0]).toBe(newer);

    const states: SettledBodyRendererState[] = [];
    const adapter = new SettledBodyRendererAdapter((state) => states.push(state), true);
    adapter.hydrateRelics([preceding, older]);
    const hydratedRevision = states.at(-1)?.relicRevision ?? 0;
    const command: BodyCommand = {
      id: "accrete:timestamped-relic:200",
      kind: "accrete",
      relic: {
        id: "timestamped-relic",
        offering_id: newer.offeringId,
        wallet: null,
        summary: "new timestamp",
        rite_id: null,
        kept_at: 100,
        genesis: 0,
        accreted_at: 200,
      },
      ink: newer,
    };
    adapter.dispatch(command, () => undefined);
    expect.soft(states.at(-1)?.relicMemory).toEqual([preceding, newer]);
    expect.soft(states.at(-1)?.relicRevision).toBe(hydratedRevision + 1);

    const committedStateCount = states.length;
    adapter.hydrateRelics([preceding, newer]);
    expect.soft(states).toHaveLength(committedStateCount);
    expect.soft(states.at(-1)?.relicRevision).toBe(hydratedRevision + 1);

    adapter.hydrateRelics([preceding, authoritative]);
    expect.soft(states.at(-1)?.relicMemory).toEqual([preceding, authoritative]);
    expect.soft(states.at(-1)?.relicRevision).toBe(hydratedRevision + 2);
    adapter.dispose();
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
