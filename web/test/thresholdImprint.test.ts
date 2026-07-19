import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  IMPRINT_SIZE,
  buildApproachPath,
  buildImprintPaths,
  buildKnockPaths,
  knockMatches,
  knockSignature,
  type GestureSample,
  type ImprintGesture,
  type KnockPress,
} from "../src/experience/thresholdImprint";

function gesture(overrides: Partial<ImprintGesture> = {}): ImprintGesture {
  return {
    seed: new Uint32Array([0x10203040, 0x50607080, 0x90a0b0c0, 0xd0e0f001]),
    start: { x: 154, y: 188 },
    end: { x: 348, y: 304 },
    holdMs: 740,
    pressure: 0.63,
    ...overrides,
  };
}

describe("threshold imprint geometry", () => {
  it("builds exactly five deterministic sparse paths inside the 512-space boundary", () => {
    const first = buildImprintPaths(gesture());
    const repeated = buildImprintPaths(gesture());

    expect(IMPRINT_SIZE).toBe(512);
    expect(first).toHaveLength(5);
    expect(repeated).toEqual(first);
    for (const path of first) {
      expect(path.points.length).toBeGreaterThanOrEqual(6);
      expect(path.points.length).toBeLessThanOrEqual(16);
      expect(path.width).toBeGreaterThan(0);
      for (const point of path.points) {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(IMPRINT_SIZE);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeLessThanOrEqual(IMPRINT_SIZE);
      }
    }
  });

  it("changes with the frozen seed and with gesture movement, pressure, duration, and release direction", () => {
    const baseline = buildImprintPaths(gesture());
    expect(buildImprintPaths(gesture({
      seed: new Uint32Array([0x10203041, 0x50607080, 0x90a0b0c0, 0xd0e0f001]),
    }))).not.toEqual(baseline);
    expect(buildImprintPaths(gesture({ end: { x: 386, y: 304 } }))).not.toEqual(baseline);
    expect(buildImprintPaths(gesture({ pressure: 0.21 }))).not.toEqual(baseline);
    expect(buildImprintPaths(gesture({ holdMs: 1_420 }))).not.toEqual(baseline);
    expect(buildImprintPaths(gesture({ end: { x: 70, y: 90 } }))).not.toEqual(baseline);
  });

  it("mixes every seed word without mutating the frozen gesture seed", () => {
    const frozenSeed = new Uint32Array([11, 22, 33, 44]);
    const baseline = buildImprintPaths(gesture({ seed: frozenSeed }));
    expect([...frozenSeed]).toEqual([11, 22, 33, 44]);
    for (let index = 0; index < frozenSeed.length; index += 1) {
      const changed = new Uint32Array(frozenSeed);
      changed[index] += 1;
      expect(buildImprintPaths(gesture({ seed: changed }))).not.toEqual(baseline);
    }
  });

  it("normalizes hostile gesture values to finite bounded geometry", () => {
    const paths = buildImprintPaths(gesture({
      start: { x: Number.NaN, y: Number.NEGATIVE_INFINITY },
      end: { x: Number.POSITIVE_INFINITY, y: 9_999 },
      holdMs: Number.NaN,
      pressure: Number.POSITIVE_INFINITY,
    }));
    expect(paths).toHaveLength(5);
    for (const path of paths) {
      expect(Number.isFinite(path.width)).toBe(true);
      expect(path.width).toBeGreaterThan(0);
      for (const point of path.points) {
        expect(Number.isFinite(point.x)).toBe(true);
        expect(Number.isFinite(point.y)).toBe(true);
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(IMPRINT_SIZE);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeLessThanOrEqual(IMPRINT_SIZE);
      }
    }
  });

  it("the Quiver: a real tremor shapes the threads deterministically, and a different hand makes a different mark", () => {
    const drift = (index: number, wobble: number): GestureSample => ({
      x: Math.sin(index * 0.9) * wobble,
      y: Math.cos(index * 1.3) * wobble,
      t: index * 16,
    });
    const handA = Array.from({ length: 40 }, (_, index) => drift(index, 1.2));
    const handB = Array.from({ length: 40 }, (_, index) => drift(index, 0.4));
    const withTremor = buildImprintPaths(gesture({ tremor: handA }));
    expect(buildImprintPaths(gesture({ tremor: handA }))).toEqual(withTremor); // same hand, same mark
    expect(buildImprintPaths(gesture({ tremor: handB }))).not.toEqual(withTremor); // a calmer hand differs
    expect(buildImprintPaths(gesture())).not.toEqual(withTremor); // and the dice-only mark differs too
    for (const path of withTremor) {
      for (const point of path.points) {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(IMPRINT_SIZE);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeLessThanOrEqual(IMPRINT_SIZE);
      }
    }
  });

  it("too few tremor samples fall back to seeded jitter instead of fabricating a tremor", () => {
    const sparse: GestureSample[] = [{ x: 0.4, y: -0.2, t: 0 }, { x: -0.1, y: 0.3, t: 30 }];
    expect(buildImprintPaths(gesture({ tremor: sparse }))).toEqual(buildImprintPaths(gesture()));
  });

  it("honest width: an unreported pressure channel stops shaping the mark; the hold takes over", () => {
    const base = gesture({ pressureReal: false });
    expect(buildImprintPaths(gesture({ ...base, pressure: 0.9 })))
      .toEqual(buildImprintPaths(gesture({ ...base, pressure: 0.1 }))); // the constant is ignored...
    expect(buildImprintPaths(gesture({ ...base, holdMs: 1_500 })))
      .not.toEqual(buildImprintPaths(base)); // ...and the always-real hold still speaks
  });

  it("the Hesitation: enough recorded wander becomes a bounded ghost path ending at the strike", () => {
    const wander: GestureSample[] = Array.from({ length: 60 }, (_, index) => ({
      x: Math.sin(index / 6) * 120 - 40,
      y: Math.cos(index / 9) * 90 + 20,
      t: index * 80,
    }));
    const path = buildApproachPath(gesture({ approach: wander }));
    expect(path).not.toBeNull();
    expect(path!.alpha).toBeLessThan(1); // ghost weight, below full ink
    expect(path!.width).toBeLessThan(1.1);
    expect(path!.points.length).toBeLessThanOrEqual(25);
    const last = path!.points[path!.points.length - 1];
    expect(last.x).toBeCloseTo(154, 0); // terminates at the strike (gesture start)
    expect(last.y).toBeCloseTo(188, 0);
    for (const point of path!.points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(IMPRINT_SIZE);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(IMPRINT_SIZE);
    }
  });

  it("no hesitation is etched for a hand that came straight or left too little wander", () => {
    expect(buildApproachPath(gesture())).toBeNull();
    const straight: GestureSample[] = Array.from({ length: 20 }, (_, index) => ({
      x: 2, y: 3, t: index * 50,
    }));
    expect(buildApproachPath(gesture({ approach: straight }))).toBeNull();
  });

  it("keeps the threshold component outside every direct Stain mutation seam", () => {
    const source = readFileSync(
      new URL("../src/experience/ThresholdOffering.tsx", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/StainSim|markAt|wickFromCanvas/);
  });
});

describe("the Knock", () => {
  const press = (downMs: number, upMs: number): KnockPress => ({ downMs, upMs });
  const rhythm = [press(0, 80), press(400, 470), press(600, 700), press(1_200, 1_310)];

  it("a signature is the rhythm, not the tempo: the same rhythm knocked slower still matches", () => {
    const slower = rhythm.map((p) => ({ downMs: p.downMs * 1.4, upMs: p.upMs * 1.4 }));
    const signature = knockSignature(rhythm);
    expect(signature).toHaveLength(3); // gaps between four blows
    expect(knockMatches(signature, knockSignature(slower))).toBe(true);
  });

  it("a stranger's rhythm and a different blow count do not match", () => {
    const stranger = [press(0, 90), press(150, 240), press(1_100, 1_180), press(1_260, 1_350)];
    expect(knockMatches(knockSignature(rhythm), knockSignature(stranger))).toBe(false);
    expect(knockMatches(knockSignature(rhythm), knockSignature(rhythm.slice(0, 3)))).toBe(false);
    expect(knockMatches([], [])).toBe(false); // no rhythm is not a match for no rhythm
  });

  it("the ladder etches one bounded dash per blow, durations as lengths, the final blow heavier", () => {
    const paths = buildKnockPaths(rhythm);
    expect(paths).toHaveLength(4);
    for (const path of paths) {
      expect(path.points).toHaveLength(2);
      for (const point of path.points) {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(IMPRINT_SIZE);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeLessThanOrEqual(IMPRINT_SIZE);
      }
    }
    // Read left to right: each dash starts past the previous one.
    for (let index = 1; index < paths.length; index += 1) {
      expect(paths[index].points[0].x).toBeGreaterThan(paths[index - 1].points[1].x - 1);
    }
    // The longest press draws the longest dash.
    const lengths = paths.map((path) => path.points[1].x - path.points[0].x);
    expect(Math.max(...lengths)).toBe(lengths[3]); // the 110ms final blow beats the 70-100ms others
    expect(paths[3].width).toBeGreaterThan(paths[0].width); // the final blow lands heavier
  });

  it("fewer than three blows are not a knock", () => {
    expect(() => buildKnockPaths(rhythm.slice(0, 2))).toThrow(/at least 3/);
  });
});
