import { describe, expect, it } from "vitest";
import { accumResolutionFor, packPieceAttributes } from "../src/becoming/becomingSim";
import type { BecomingPiece } from "../src/becoming/pieces";

const piece = (overrides: Partial<BecomingPiece> = {}): BecomingPiece => ({
  offeringId: "id",
  x: 0.5,
  y: 0.5,
  scale: 0.08,
  rotation: 1.2,
  genesis: false,
  ...overrides,
});

describe("accumResolutionFor — accumulation bake resolution per tier", () => {
  it("gives mobile a smaller bake than desktop", () => {
    expect(accumResolutionFor("mobile")).toBeLessThan(accumResolutionFor("desktop"));
  });

  it("is a fixed power-of-two-ish size independent of anything but tier", () => {
    expect(accumResolutionFor("desktop")).toBe(512);
    expect(accumResolutionFor("mobile")).toBe(256);
  });
});

describe("packPieceAttributes — the accumulation vertex buffer layout", () => {
  it("packs one 5-float row per piece in input order: x, y, scale, rotation, genesis", () => {
    const pieces = [
      piece({ x: 0.1, y: 0.2, scale: 0.05, rotation: 0.3, genesis: false }),
      piece({ x: 0.6, y: 0.7, scale: 0.14, rotation: 5.9, genesis: true }),
    ];
    const data = packPieceAttributes(pieces);
    expect(data.length).toBe(10);
    // Float32Array precision, not exact double equality — Math.fround matches what the buffer stored.
    const expected = [0.1, 0.2, 0.05, 0.3, 0, 0.6, 0.7, 0.14, 5.9, 1].map(Math.fround);
    expect(Array.from(data)).toEqual(expected);
  });

  it("packs zero pieces into an empty buffer", () => {
    expect(packPieceAttributes([]).length).toBe(0);
  });
});
