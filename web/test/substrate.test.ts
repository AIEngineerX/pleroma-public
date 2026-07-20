import { describe, expect, it } from "vitest";
import { sampleSubstrateData } from "../src/experience/substrate";

// A tiny synthetic raster stands in for the 512-space canvas the browser wrapper would draw --
// the pure core only ever sees RGBA bytes + dimensions, never a DOM canvas (house rule: no real
// canvas in the unit-test environment, and we do not mock one).
function blankRaster(width: number, height: number): Uint8ClampedArray {
  return new Uint8ClampedArray(width * height * 4); // alpha 0 everywhere
}

function setOpaque(data: Uint8ClampedArray, width: number, x: number, y: number): void {
  const i = (y * width + x) * 4;
  data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255;
}

// Draws a straight run of opaque pixels -- a "stroke" -- from (x0,y0) to (x1,y1) along one axis.
function drawStrokeH(data: Uint8ClampedArray, width: number, y: number, x0: number, x1: number): void {
  for (let x = x0; x <= x1; x += 1) setOpaque(data, width, x, y);
}
function drawStrokeV(data: Uint8ClampedArray, width: number, x: number, y0: number, y1: number): void {
  for (let y = y0; y <= y1; y += 1) setOpaque(data, width, x, y);
}

describe("sampleSubstrateData (pure core, no DOM/canvas)", () => {
  it("returns 2..64 finite-angle points, all on inked cells, for two drawn strokes", () => {
    const width = 128, height = 128;
    const data = blankRaster(width, height);
    // Two separate strokes far apart so both leave their own inked cells.
    drawStrokeH(data, width, 20, 10, 60);
    drawStrokeV(data, width, 100, 70, 110);

    const points = sampleSubstrateData(data, width, height);

    expect(points.length).toBeGreaterThanOrEqual(2);
    expect(points.length).toBeLessThanOrEqual(64);
    for (const point of points) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
      expect(Number.isFinite(point.angle)).toBe(true);
      // Every point must land within the fixed 512-unit growth space, not the raster's own bounds.
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(512);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(512);
    }
  });

  it("never exceeds 64 points even when every cell is inked", () => {
    const width = 64, height = 64;
    const data = new Uint8ClampedArray(width * height * 4).fill(255); // fully opaque everywhere
    const points = sampleSubstrateData(data, width, height);
    expect(points.length).toBeLessThanOrEqual(64);
    expect(points.length).toBeGreaterThan(0);
  });

  it("returns no points for an all-transparent raster", () => {
    const width = 128, height = 128;
    const data = blankRaster(width, height);
    expect(sampleSubstrateData(data, width, height)).toEqual([]);
  });

  it("gives an isolated inked cell angle 0", () => {
    const width = 128, height = 128;
    const data = blankRaster(width, height);
    // A single opaque pixel far from any edge, with nothing nearby -- its cell has no inked
    // neighbors, so its angle must be exactly 0 (the "isolated" case).
    setOpaque(data, width, 64, 64);
    const points = sampleSubstrateData(data, width, height);
    expect(points.length).toBe(1);
    expect(points[0].angle).toBe(0);
  });
});
