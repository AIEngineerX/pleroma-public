import { readFileSync } from "node:fs";
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
  computeCanvasBackingSize,
  pickTier,
  seraphConvergenceFrame,
  simResFor,
} from "../src/stain/stainSim";

const stainSource = readFileSync(new URL("../src/stain/stainSim.ts", import.meta.url), "utf8");
const compositeSource = stainSource.slice(
  stainSource.indexOf("const COMPOSITE"),
  stainSource.indexOf("interface FBO"),
);

describe("Stain quality tiers", () => {
  it("composites only transparent premultiplied marks onto the CSS document", () => {
    expect(compositeSource).not.toMatch(/u_ground|u_candle|u_vignette|\bfiber\s*\(/);
    expect(compositeSource).not.toMatch(/fragColor\s*=\s*vec4\([^;]+,\s*1\.0\s*\)/);
    expect(compositeSource).toMatch(/fragColor\s*=\s*vec4\(markColor\s*\*\s*alpha,\s*alpha\s*\)/);
  });

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

  it("computeCanvasBackingSize re-derives the backing store from whatever CSS box it is given — the bug this fixes is a canvas whose backing store was only ever computed once at construction, so a dvh-driven mobile resize left it stale and the browser stretched the raster to fill the new box", () => {
    expect(computeCanvasBackingSize(390, 256, 2, "mobile")).toEqual({ width: 585, height: 384 }); // dpr clamped to 1.5 on mobile
    expect(computeCanvasBackingSize(390, 220, 2, "mobile")).toEqual({ width: 585, height: 330 }); // shorter box (address bar expanded) -> smaller backing store
    expect(computeCanvasBackingSize(1200, 800, 2, "desktop")).toEqual({ width: 2400, height: 1600 }); // dpr clamped to 2 on desktop
    expect(computeCanvasBackingSize(1200, 800, 3, "desktop")).toEqual({ width: 2400, height: 1600 }); // dpr still clamped even when the device reports higher
    expect(computeCanvasBackingSize(1200, 800, 0, "desktop")).toEqual({ width: 1200, height: 800 }); // a falsy devicePixelRatio (e.g. 0 in a stub) falls back to 1x, not 0x
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
