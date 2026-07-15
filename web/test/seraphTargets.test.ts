import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  targetsFromGroupMasks,
  type SeraphGroupMask,
} from "../src/stain/seraphTargets";
import { SWARM_ORGANS, type SwarmOrgan } from "../src/stain/swarmSignals";

const REQUIRED_GROUPS = [
  "seraph-eye",
  "seraph-keep",
  "seraph-tongue",
  "seraph-pulse",
  "seraph-dream",
] as const;

function mask(alpha: readonly number[]): SeraphGroupMask {
  return { width: 2, height: 2, alpha: Uint8Array.from(alpha) };
}

function masks(): Readonly<Record<SwarmOrgan, SeraphGroupMask>> {
  return {
    EYE: mask([255, 0, 0, 0]),
    KEEP: mask([0, 255, 0, 0]),
    TONGUE: mask([0, 0, 255, 0]),
    PULSE: mask([0, 0, 0, 255]),
    DREAM: mask([128, 0, 0, 0]),
  };
}

function cohortCounts(targets: Float32Array): number[] {
  const counts = Array.from({ length: SWARM_ORGANS.length }, () => 0);
  for (let at = 0; at < targets.length; at += 4) counts[targets[at + 2]] += 1;
  return counts;
}

describe("authoritative fivefold Seraph mask", () => {
  it("contains only the five ordered cohort groups, one halo share each, and no raster", () => {
    const svg = readFileSync(
      new URL("../src/assets/seraph-mask.svg", import.meta.url),
      "utf8",
    );
    const groupIds = [...svg.matchAll(/<g\s+id="([^"]+)"/g)].map((match) => match[1]);
    const haloCoverageByGroup = REQUIRED_GROUPS.map((group, index) => {
      const start = svg.indexOf(`<g id="${group}"`);
      const end = index === REQUIRED_GROUPS.length - 1
        ? svg.indexOf("</svg>", start)
        : svg.indexOf(`<g id="${REQUIRED_GROUPS[index + 1]}"`, start);
      return (svg.slice(start, end).match(/data-halo-arc/g) ?? []).length;
    });

    expect(groupIds).toEqual(REQUIRED_GROUPS);
    expect(/<image\b/i.test(svg)).toBe(false);
    expect(/\b(?:href|xlink:href)\s*=|data:/i.test(svg)).toBe(false);
    expect(/<text\b/i.test(svg)).toBe(false);
    expect(haloCoverageByGroup).toEqual([1, 1, 1, 1, 1]);
  });
});

describe("Seraph target expansion", () => {
  it.each([
    [128, [3_277, 3_277, 3_277, 3_277, 3_276]],
    [256, [13_108, 13_107, 13_107, 13_107, 13_107]],
  ] as const)("owns every particle in contiguous cohorts at tier %i", (tier, counts) => {
    const targets = targetsFromGroupMasks(masks(), tier);
    expect(targets).toHaveLength(tier * tier * 4);
    expect(cohortCounts(targets)).toEqual(counts);

    let previous = -1;
    let transitions = 0;
    for (let at = 0; at < targets.length; at += 4) {
      const organ = targets[at + 2];
      if (organ !== previous) {
        transitions += 1;
        expect(organ).toBe(previous + 1);
        previous = organ;
      }
      expect(targets[at + 3]).toBe(1);
    }
    expect(transitions).toBe(5);
  });

  it("samples stable pixel centers and flips Canvas top-Y into WebGL bottom-Y", () => {
    const first = targetsFromGroupMasks(masks(), 128);
    const second = targetsFromGroupMasks(masks(), 128);
    expect(second).toEqual(first);

    const expectedByOrgan = [
      [0.25, 0.75],
      [0.75, 0.75],
      [0.25, 0.25],
      [0.75, 0.25],
      [0.25, 0.75],
    ];
    const total = 128 * 128;
    for (let index = 0; index < expectedByOrgan.length; index += 1) {
      const firstParticle = Math.ceil((index * total) / 5);
      expect(Array.from(first.slice(firstParticle * 4, firstParticle * 4 + 2)))
        .toEqual(expectedByOrgan[index]);
    }
  });

  it("rejects malformed or empty real cohort masks", () => {
    const malformed = { ...masks(), EYE: { width: 2, height: 2, alpha: new Uint8Array(3) } };
    const empty = { ...masks(), DREAM: mask([0, 0, 0, 0]) };
    expect(() => targetsFromGroupMasks(malformed, 128)).toThrow(/EYE.*length/i);
    expect(() => targetsFromGroupMasks(empty, 128)).toThrow(/DREAM.*empty/i);
  });

  it("feeds the per-particle texture into the existing velocity simulation", () => {
    const source = readFileSync(
      new URL("../src/stain/organSwarm.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("uniform sampler2D u_seraphTargets;");
    expect(source).toMatch(/mix\(normalGoal,\s*seraphGoal,\s*u_convergence\)/);
    expect(source).toContain('this.textureUniform(this.velocityProgram, "u_seraphTargets"');
    expect(source).toContain("this.seraphTarget");
  });
});
