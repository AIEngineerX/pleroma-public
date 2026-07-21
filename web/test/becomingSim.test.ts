import { describe, expect, it } from "vitest";
import { accumResolutionFor, fitBodyUv, packPieceAttributes } from "../src/becoming/becomingSim";
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

describe("fitBodyUv — xMidYMid-meet registration between the WebGL body and the SVG beneath", () => {
  it("is the identity on a square canvas", () => {
    expect(fitBodyUv({ x: 0.3, y: 0.7 }, 1)).toEqual({ x: 0.3, y: 0.7 });
    expect(fitBodyUv({ x: 0, y: 1 }, 1)).toEqual({ x: 0, y: 1 });
  });

  it("pillarboxes a wide canvas: x is centered and scaled, margins fall outside the body", () => {
    // aspect 2 → the square occupies the middle half of the canvas width, full height.
    expect(fitBodyUv({ x: 0.5, y: 0.5 }, 2)).toEqual({ x: 0.5, y: 0.5 });
    expect(fitBodyUv({ x: 0.25, y: 0.5 }, 2)).toEqual({ x: 0, y: 0.5 }); // left edge of the fitted square
    expect(fitBodyUv({ x: 0.75, y: 0.5 }, 2)).toEqual({ x: 1, y: 0.5 }); // right edge of the fitted square
    expect(fitBodyUv({ x: 0, y: 0.5 }, 2)).toBeNull(); // left pillarbox margin — no body here
    expect(fitBodyUv({ x: 1, y: 0.5 }, 2)).toBeNull(); // right pillarbox margin
  });

  it("letterboxes a tall canvas: y is centered and scaled, margins fall outside the body", () => {
    // aspect 0.5 → the square occupies the middle half of the canvas height, full width.
    expect(fitBodyUv({ x: 0.5, y: 0.5 }, 0.5)).toEqual({ x: 0.5, y: 0.5 });
    expect(fitBodyUv({ x: 0.5, y: 0.25 }, 0.5)).toEqual({ x: 0.5, y: 0 }); // top edge of the fitted square
    expect(fitBodyUv({ x: 0.5, y: 0.75 }, 0.5)).toEqual({ x: 0.5, y: 1 }); // bottom edge of the fitted square
    expect(fitBodyUv({ x: 0.5, y: 0 }, 0.5)).toBeNull(); // top letterbox margin — no body here
    expect(fitBodyUv({ x: 0.5, y: 1 }, 0.5)).toBeNull(); // bottom letterbox margin
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
