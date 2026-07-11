import { describe, expect, it } from "vitest";
import { selectForPerception } from "../src/eye";
import type { OfferingRow } from "../src/db";

function off(id: string, wallet: string | null): OfferingRow {
  return { id, wallet, sig: null, image_key: `offerings/${id}.png`, sha256: id,
    status: "perceivable", attempts: 0, created_at: 0, perceived_at: null };
}

describe("selectForPerception", () => {
  it("caps the batch at 12 and always includes attended wallets", () => {
    const attended = new Set(["holderA"]);
    const candidates = [off("h1", "holderA"), ...Array.from({ length: 20 }, (_, i) => off(`n${i}`, `w${i}`))];
    const picked = selectForPerception(candidates, attended, 0, 0, () => 0.5);
    expect(picked.length).toBe(12);
    expect(picked.map(o => o.id)).toContain("h1");
  });

  it("stops selecting non-holders at the 60/day cap", () => {
    const candidates = Array.from({ length: 12 }, (_, i) => off(`n${i}`, `w${i}`));
    const picked = selectForPerception(candidates, new Set(), 60, 60, () => 0.5);
    expect(picked.length).toBe(0);
  });

  it("stops everything at the 200/day global cap", () => {
    const candidates = [off("h1", "holderA")];
    const picked = selectForPerception(candidates, new Set(["holderA"]), 0, 200, () => 0.5);
    expect(picked.length).toBe(0);
  });
});
