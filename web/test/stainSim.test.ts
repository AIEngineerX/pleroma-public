import { describe, expect, it, vi } from "vitest";
import { BODY_ANCHORS, anchorsFromSwarmCentroids } from "../src/stain/bodyRenderer";
import {
  ACCRETION_DURATION_MS,
  ARRIVAL_DURATION_MS,
  SERAPH_CONVERGE_MS,
  SERAPH_DISSOLVE_MS,
  SERAPH_HOLD_MS,
  accretionProgress,
  arrivalProgress,
  pickTier,
  seraphConvergenceFrame,
  simResFor,
} from "../src/stain/stainSim";

describe("Stain quality tiers", () => {
  it("resolves presentation-only emergence over 2.5 seconds with an exponential ease", () => {
    expect(ARRIVAL_DURATION_MS).toBe(2_500);
    expect(arrivalProgress(0)).toBe(0);
    expect(arrivalProgress(ARRIVAL_DURATION_MS / 2)).toBeGreaterThan(0.9);
    expect(arrivalProgress(ARRIVAL_DURATION_MS)).toBe(1);
    expect(arrivalProgress(0, true)).toBe(1);
  });

  it("returns reduced when prefers-reduced-motion is set", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduced-motion"), media: q, addEventListener() {}, removeEventListener() {} }));
    expect(pickTier()).toBe("reduced");
    expect(simResFor("reduced")).toBe(0); // no sim
  });
  it("uses a cheaper sim resolution on mobile than desktop", () => {
    expect(simResFor("mobile")).toBeLessThan(simResFor("desktop"));
    expect(simResFor("desktop")).toBe(512);
    expect(simResFor("mobile")).toBe(256);
  });

  it("owns one 1.2 second threshold-to-body accretion clock", () => {
    expect(ACCRETION_DURATION_MS).toBe(1_200);
    expect(accretionProgress(0)).toBe(0);
    expect(accretionProgress(600)).toBeGreaterThan(0.5);
    expect(accretionProgress(1_200)).toBe(1);
    expect(accretionProgress(9_000)).toBe(1);
  });

  it("owns the exact gather, witness, and dissolve DREAM clock", () => {
    expect([SERAPH_CONVERGE_MS, SERAPH_HOLD_MS, SERAPH_DISSOLVE_MS])
      .toEqual([1_800, 6_000, 2_400]);
    expect(seraphConvergenceFrame(0)).toEqual({ phase: "gather", convergence: 0, complete: false });
    expect(seraphConvergenceFrame(900)).toMatchObject({ phase: "gather", complete: false });
    expect(seraphConvergenceFrame(900).convergence).toBeGreaterThan(0.9);
    expect(seraphConvergenceFrame(1_800)).toEqual({ phase: "hold", convergence: 1, complete: false });
    expect(seraphConvergenceFrame(7_800)).toEqual({ phase: "dissolve", convergence: 1, complete: false });
    expect(seraphConvergenceFrame(9_000)).toMatchObject({ phase: "dissolve", complete: false });
    expect(seraphConvergenceFrame(9_000).convergence).toBeLessThan(0.1);
    expect(seraphConvergenceFrame(10_200)).toEqual({ phase: "five", convergence: 0, complete: true });
  });

  it("normalizes WebGL y-up centroids to the shared SVG y-down anchors", () => {
    const anchors = anchorsFromSwarmCentroids(new Float32Array([
      0.50, 0.72,
      0.70, 0.57,
      0.64, 0.34,
      0.36, 0.34,
      0.30, 0.57,
    ]));

    for (const organ of ["EYE", "KEEP", "TONGUE", "PULSE", "DREAM"] as const) {
      expect(anchors[organ].x).toBeCloseTo(BODY_ANCHORS[organ].x);
      expect(anchors[organ].y).toBeCloseTo(BODY_ANCHORS[organ].y);
    }
    expect(anchors.seraph).toEqual(BODY_ANCHORS.seraph);
  });
});
