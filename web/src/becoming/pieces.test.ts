import { describe, expect, it } from "vitest";
import { placePieces } from "./pieces";

const relic = (offering_id: string, genesis = 0) => ({ offering_id, genesis });

describe("placePieces", () => {
  it("places one piece per relic, deduped by offering_id", () => {
    const pieces = placePieces([relic("a"), relic("b"), relic("a")]);
    expect(pieces.map((p) => p.offeringId).sort()).toEqual(["a", "b"]);
  });

  it("is a pure function of offering_id — a piece never moves when others are added", () => {
    const before = placePieces([relic("a")]);
    const after = placePieces([relic("a"), relic("b"), relic("c")]);
    const a1 = before.find((p) => p.offeringId === "a")!;
    const a2 = after.find((p) => p.offeringId === "a")!;
    expect({ x: a2.x, y: a2.y, scale: a2.scale, rotation: a2.rotation })
      .toEqual({ x: a1.x, y: a1.y, scale: a1.scale, rotation: a1.rotation });
  });

  it("keeps every piece inside the body-space bounds", () => {
    const pieces = placePieces(Array.from({ length: 200 }, (_, i) => relic(`id-${i}`)));
    for (const p of pieces) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
      expect(p.scale).toBeGreaterThan(0);
      expect(p.rotation).toBeGreaterThanOrEqual(0);
      expect(p.rotation).toBeLessThan(Math.PI * 2);
    }
  });

  it("anchors the genesis relic at the core", () => {
    const [g] = placePieces([relic("genesis-mark", 1)]);
    expect(g.genesis).toBe(true);
    expect(Math.hypot(g.x - 0.5, g.y - 0.5)).toBeLessThan(0.08);
  });
});
