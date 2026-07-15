import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  IMPRINT_SIZE,
  buildImprintPaths,
  type ImprintGesture,
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

  it("keeps the threshold component outside every direct Stain mutation seam", () => {
    const source = readFileSync(
      new URL("../src/experience/ThresholdOffering.tsx", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/StainSim|markAt|wickFromCanvas/);
  });
});
