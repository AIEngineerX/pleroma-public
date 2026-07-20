// Task 3 (grown-lineage-marks): ThresholdOffering now grows its previews from growMark instead of
// the fixed five-thread/dash-ladder builders, and attaches an honest gesture summary to every
// offering. No DOM/jsdom is configured in this project (component-level rendering with real
// pointer gestures isn't exercisable in a unit test here), so this file unit-tests the two pure
// pieces the rewrite introduced: buildGestureSummary (the FormData metadata builder, extracted as
// an exported pure function) and the growMark wiring itself (verified directly, exactly as the
// task brief permits -- "through the component's path (or directly via growMark with the same
// substrate)").
import { describe, expect, it } from "vitest";
import { buildGestureSummary, grainBudget, growthStepsForElapsed, releaseBurstCount, shouldRecomputeGrowth } from "../src/experience/ThresholdOffering";
import { growMark, startGrowth, stepGrowth, topologyMetrics, type SubstratePoint } from "../src/experience/markGrowth";
import {
  KNOCK_MAX_PRESSES,
  imprintHold,
  knockSignature,
  tremorTrace,
  type ImprintGesture,
  type KnockPress,
} from "../src/experience/thresholdImprint";

const seed = new Uint32Array([7, 11, 13, 17]);

const tremorA = Array.from({ length: 40 }, (_, i) => ({ x: Math.sin(i / 3) * 1.2, y: Math.cos(i / 5) * 0.8, t: i * 16 }));
const tremorB = Array.from({ length: 40 }, (_, i) => ({ x: Math.sin(i / 7) * 0.4, y: Math.sin(i / 2) * 1.5, t: i * 16 }));

const substrate: SubstratePoint[] = [
  { x: 120, y: 120, angle: 0 },
  { x: 400, y: 380, angle: 1.2 },
];

function holdGesture(overrides: Partial<ImprintGesture> = {}): ImprintGesture {
  return {
    seed,
    start: { x: 100, y: 100 },
    end: { x: 130, y: 140 },
    holdMs: 900,
    pressure: 0.5,
    pressureReal: false,
    tremor: tremorA,
    ...overrides,
  };
}

describe("buildGestureSummary — the offering's honest, non-fabricated gesture capture", () => {
  it("a hold fixture reports holdMs/travelPx/tremorAmp/pigmentIntensity and an empty knockSig", () => {
    const gesture = holdGesture();
    const summary = buildGestureSummary(gesture, null, { relicId: "relic-1", own: true });

    expect(summary.holdMs).toBe(900);
    expect(summary.travelPx).toBeCloseTo(Math.hypot(30, 40), 6); // 50
    const trace = tremorTrace(gesture.tremor);
    const expectedTremorAmp = trace === null ? 0 : Math.max(...trace.map(Math.abs));
    expect(summary.tremorAmp).toBeCloseTo(expectedTremorAmp, 6);
    expect(summary.pigmentIntensity).toBeCloseTo(imprintHold(gesture), 6);
    expect(summary.knockSig).toEqual([]);
    expect(summary.substrateRelicId).toBe("relic-1");
    expect(summary.substrateOwn).toBe(true);
  });

  it("a knock fixture reports knockSig from knockSignature and pigmentIntensity clamped to presses/KNOCK_MAX_PRESSES", () => {
    const presses: KnockPress[] = [
      { downMs: 0, upMs: 60 },
      { downMs: 220, upMs: 270 },
      { downMs: 430, upMs: 480 },
      { downMs: 650, upMs: 700 },
      { downMs: 900, upMs: 950 },
    ];
    const gesture = holdGesture({ holdMs: 950 });
    const summary = buildGestureSummary(gesture, presses, { relicId: null, own: false });

    expect(summary.knockSig).toEqual(knockSignature(presses));
    expect(summary.knockSig.length).toBeGreaterThan(0);
    expect(summary.pigmentIntensity).toBeCloseTo(presses.length / KNOCK_MAX_PRESSES, 6);
    expect(summary.pigmentIntensity).toBeLessThanOrEqual(1);
    expect(summary.substrateRelicId).toBeNull();
    expect(summary.substrateOwn).toBe(false);
  });

  it("a knock longer than KNOCK_MAX_PRESSES still clamps pigmentIntensity to at most 1", () => {
    const presses: KnockPress[] = Array.from({ length: KNOCK_MAX_PRESSES + 4 }, (_, i) => ({
      downMs: i * 150, upMs: i * 150 + 40,
    }));
    const summary = buildGestureSummary(holdGesture(), presses, { relicId: null, own: false });
    expect(summary.pigmentIntensity).toBe(1);
  });

  it("no approach recorded → approachSpreadPx is 0 (never fabricated)", () => {
    const summary = buildGestureSummary(holdGesture({ approach: undefined }), null, { relicId: null, own: false });
    expect(summary.approachSpreadPx).toBe(0);
  });

  it("fewer than 6 approach samples → approachSpreadPx is 0, mirroring buildApproachPath's own threshold", () => {
    const approach = [
      { x: 0, y: 0, t: 0 }, { x: 5, y: 2, t: 10 }, { x: 9, y: 4, t: 20 },
    ];
    const summary = buildGestureSummary(holdGesture({ approach }), null, { relicId: null, own: false });
    expect(summary.approachSpreadPx).toBe(0);
  });

  it("6+ approach samples → approachSpreadPx is the max axis spread, computed honestly", () => {
    const approach = [
      { x: -10, y: -5, t: 0 },
      { x: -4, y: -2, t: 10 },
      { x: 0, y: 0, t: 20 },
      { x: 6, y: 3, t: 30 },
      { x: 10, y: 5, t: 40 },
      { x: 15, y: 1, t: 50 },
    ];
    // x spans -10..15 (25), y spans -5..5 (10) -- the max axis spread is 25.
    const summary = buildGestureSummary(holdGesture({ approach }), null, { relicId: null, own: false });
    expect(summary.approachSpreadPx).toBe(25);
  });
});

describe("ThresholdOffering's preview now grows on the residue: growMark wiring diverges honestly", () => {
  it("two different tremor fixtures through the same substrate produce structurally different organisms", () => {
    const a = topologyMetrics(growMark(holdGesture({ tremor: tremorA }), substrate));
    const b = topologyMetrics(growMark(holdGesture({ tremor: tremorB }), substrate));
    expect(a).not.toEqual(b);
  });

  it("a resolved knock (gesture + presses) diverges from the same gesture presented as a bare hold", () => {
    const presses: KnockPress[] = [
      { downMs: 0, upMs: 60 }, { downMs: 300, upMs: 350 }, { downMs: 620, upMs: 670 }, { downMs: 950, upMs: 990 },
    ];
    const gesture = holdGesture({ holdMs: 990 });
    const knocked = topologyMetrics(growMark(gesture, substrate, presses));
    const bare = topologyMetrics(growMark(gesture, substrate));
    expect(knocked).not.toEqual(bare);
  });
});

// Task 4 (grown-lineage-marks): the live hold's own pacing. growthStepsForElapsed is the pure
// elapsed-ms -> step-count mapping the live rAF loop feeds to stepGrowth every frame; these are
// the properties the task brief names directly (monotonic, 0 at 0, equals growMark's own full-hold
// step budget), verified with no DOM.
describe("growthStepsForElapsed — the live hold's elapsed-to-steps pacing", () => {
  it("is 0 at 0 elapsed", () => {
    expect(growthStepsForElapsed(0)).toBe(0);
    expect(growthStepsForElapsed(-50)).toBe(0);
  });

  it("is monotonically non-decreasing as elapsed grows", () => {
    const samples = [0, 40, 90, 160, 300, 500, 800, 1_100, 1_400, 1_600, 2_000, 5_000];
    let previous = -1;
    for (const elapsedMs of samples) {
      const steps = growthStepsForElapsed(elapsedMs);
      expect(steps).toBeGreaterThanOrEqual(previous);
      previous = steps;
    }
  });

  it("reaches growMark's own full-hold step budget (12 + 52 = 64) at and beyond 1.6s, never past it", () => {
    expect(growthStepsForElapsed(1_600)).toBe(64);
    expect(growthStepsForElapsed(3_000)).toBe(64);
    expect(growthStepsForElapsed(1_500)).toBeLessThan(64);
  });

  it("honors a caller-supplied holdMsBudget the same way", () => {
    expect(growthStepsForElapsed(0, 800)).toBe(0);
    expect(growthStepsForElapsed(800, 800)).toBe(64);
    expect(growthStepsForElapsed(400, 800)).toBe(32);
  });

  it("never outruns the state's own step budget: growthStepsForElapsed(elapsed) <= maxSteps for a gesture whose own holdMs is that same elapsed", () => {
    for (const elapsedMs of [0, 50, 200, 500, 900, 1_200, 1_600]) {
      const state = startGrowth(holdGesture({ holdMs: elapsedMs }), substrate);
      expect(growthStepsForElapsed(elapsedMs)).toBeLessThanOrEqual(state.maxSteps);
    }
  });

  it("at a full 1.6s hold, stepping by growthStepsForElapsed converges to exactly what growMark itself renders for that same gesture", () => {
    const gesture = holdGesture({ holdMs: 1_600 });
    const state = startGrowth(gesture, substrate);
    const stepped = stepGrowth(state, growthStepsForElapsed(1_600));
    expect(stepped.done).toBe(true);
    expect(stepped.segments).toEqual(growMark(gesture, substrate));
  });

  it("mid-hold, the live-paced state is never further along (more points, more splits) than the full-hold mark, and never regresses as elapsed grows", () => {
    const totalPoints = (segments: { points: readonly unknown[] }[]) =>
      segments.reduce((sum, path) => sum + path.points.length, 0);
    const full = startGrowth(holdGesture({ holdMs: 1_600 }), substrate);
    const fullPoints = totalPoints(stepGrowth(full, growthStepsForElapsed(1_600)).segments);

    let previousPoints = 0;
    for (const elapsedMs of [200, 500, 900, 1_300, 1_600]) {
      const state = startGrowth(holdGesture({ holdMs: elapsedMs }), substrate);
      const stepped = stepGrowth(state, growthStepsForElapsed(elapsedMs));
      const points = totalPoints(stepped.segments);
      expect(points).toBeLessThanOrEqual(fullPoints);
      expect(points).toBeGreaterThanOrEqual(previousPoints);
      previousPoints = points;
    }
  });
});

// Task 4 fix (reviewer finding 1): the live hold's rAF loop now throttles its growth recompute to
// this pure gate rather than rebuilding startGrowth + up to 64 stepGrowth steps every frame.
// shouldRecomputeGrowth is the exact boundary the tick loop consults; verified in isolation, no DOM.
describe("shouldRecomputeGrowth — the live hold's 20Hz growth-recompute gate", () => {
  it("is false for a gap under 50ms", () => {
    expect(shouldRecomputeGrowth(0, 49)).toBe(false);
    expect(shouldRecomputeGrowth(100, 149)).toBe(false);
  });

  it("is true at exactly 50ms (the boundary is inclusive, matching the effect's own comment)", () => {
    expect(shouldRecomputeGrowth(0, 50)).toBe(true);
    expect(shouldRecomputeGrowth(100, 150)).toBe(true);
  });

  it("is true for any gap past 50ms", () => {
    expect(shouldRecomputeGrowth(0, 51)).toBe(true);
    expect(shouldRecomputeGrowth(0, 1_000)).toBe(true);
  });

  it("is true on the very first frame, where the tick loop seeds lastComputeMs at -Infinity", () => {
    expect(shouldRecomputeGrowth(-Infinity, 0)).toBe(true);
  });

  it("is false when no time has passed at all", () => {
    expect(shouldRecomputeGrowth(50, 50)).toBe(false);
  });
});

// Task 5 (grown-lineage-marks §3b.6): the paper-fiber grain's own rate limit. grainBudget is the
// pure predicate the live hold loop consults before calling emitGrain -- a rolling 1s window over
// the caller's own recent-grain timestamps, verified in isolation with no audio API involved.
describe("grainBudget — the paper-fiber grain's rate limit (max 8/s)", () => {
  it("allows a grain with no prior history at all", () => {
    expect(grainBudget(0, [])).toBe(true);
  });

  it("allows the 8th grain when only 7 fall within the last second", () => {
    const times = [0, 100, 200, 300, 400, 500, 600];
    expect(grainBudget(650, times)).toBe(true);
  });

  it("refuses a 9th grain once 8 already fall within the last second", () => {
    const times = [0, 100, 200, 300, 400, 500, 600, 700];
    expect(grainBudget(750, times)).toBe(false);
  });

  it("a grain exactly 1000ms old has aged out of the window (the boundary is exclusive)", () => {
    // 8 timestamps, but by nowMs=1_000 the first (t=0) is exactly 1_000ms old and no longer counts,
    // leaving 7 -- under budget.
    const times = [0, 100, 200, 300, 400, 500, 600, 700];
    expect(grainBudget(1_000, times)).toBe(true);
  });

  it("timestamps older than the window never count against the budget, however many there are", () => {
    const ancientHistory = Array.from({ length: 50 }, (_, i) => i * 10); // all well over 1s old by nowMs
    expect(grainBudget(50_000, ancientHistory)).toBe(true);
  });

  // Finding 1 (code review, grown-lineage-marks §3b.6): grainTimes was a local `let` inside the
  // seal-canvas effect, whose dep array includes `phase` -- so every hold start/end tore the
  // closure down and handed the next gesture a brand new empty array, silently resetting the
  // budget every gesture instead of holding it across a rapid run of holds as intended. The fix
  // hoists the array to a component-scope ref; grainBudget itself is a pure predicate over
  // whatever array the caller hands it, so the rolling-window-across-gestures behavior is provable
  // here directly: simulate two "gestures" as two bursts of pushes against ONE shared array (never
  // reset between them, exactly like the hoisted ref survives the effect's teardown/rebuild) and
  // confirm the second gesture's budget is constrained by the first's still-recent grains.
  it("the rolling window carries across two simulated gestures sharing one times array (the Finding 1 fix)", () => {
    const times: number[] = [];
    // Gesture 1: spends the full 8-grain budget (the cap grainBudget itself enforces) in the
    // first 70ms.
    for (let i = 0; i < 8; i += 1) {
      expect(grainBudget(i * 10, times)).toBe(true);
      times.push(i * 10);
    }
    // Still well within 1s of gesture 1's grains (no reset happened, matching the hoisted ref) --
    // a fresh "gesture 2" starting right away must NOT get its own fresh 8-grain allowance.
    expect(grainBudget(90, times)).toBe(false);
    // Only once gesture 1's own grains have actually aged out of the 1s window does budget free up.
    expect(grainBudget(1_100, times)).toBe(true);
  });
});

// Task 5 fix (Finding 2, code review): reduced-motion visitors took the seal-canvas effect's
// early-return branch, which never runs the growth-stepping tick loop at all -- so GrowthState.
// splits was never computed and no grain ever fired for them, even though the binding rule is
// "reduced motion does NOT gate sound; only the ambient gate does." releaseBurstCount is the pure
// seam the fix's release-time burst uses to size itself: one grain per branch the FINAL mark ended
// up with (pathCount - 1, matching markGrowth's topologyMetrics.branches accounting), capped at
// whatever the shared rolling budget has left.
describe("releaseBurstCount — the reduced-motion release burst's own sizing (Finding 2 fix)", () => {
  it("a mark with 0 paths (nothing grew) bursts 0 grains", () => {
    expect(releaseBurstCount(0, 8)).toBe(0);
  });

  it("a single-path mark (no splits at all) bursts 0 grains", () => {
    expect(releaseBurstCount(1, 8)).toBe(0);
  });

  it("one grain per branch when the budget has ample room", () => {
    expect(releaseBurstCount(5, 8)).toBe(4); // 5 paths = 4 branches, well under the 8 remaining
  });

  it("caps at whatever budget remains, even when the mark grew far more branches", () => {
    expect(releaseBurstCount(20, 3)).toBe(3); // 19 branches, but only 3 grains left in the window
  });

  it("a fully spent budget bursts 0 grains regardless of how many branches grew", () => {
    expect(releaseBurstCount(20, 0)).toBe(0);
  });

  it("never goes negative on a malformed negative remaining budget", () => {
    expect(releaseBurstCount(5, -3)).toBe(0);
  });
});
