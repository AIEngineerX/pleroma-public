import { describe, expect, it } from "vitest";
import type { RelicEntry } from "../src/state/types";
import type { AccretedRelic, RelicInkSample } from "../src/experience/types";
import {
  RELIC_MEMORY_LIMIT,
  RELIC_SAMPLE_SIZE,
  foldRelicSamples,
  isAccreted,
  mergeRelicAlpha,
  relicAccretionKey,
  relicImageUrl,
  selectAccretedRelics,
} from "../src/stain/relicInk";

function relic(index: number, accretedAt: number | null = index + 1): RelicEntry {
  return {
    id: `relic-${index}`,
    offering_id: `offering-${index}`,
    wallet: null,
    summary: `kept mark ${index}`,
    rite_id: null,
    kept_at: 10_000 - index,
    genesis: 0,
    accreted_at: accretedAt,
  };
}

function sample(offeringId = "offering-ink", alpha = 208): RelicInkSample {
  const pixels = new Uint8Array(RELIC_SAMPLE_SIZE * RELIC_SAMPLE_SIZE);
  for (let y = 7; y < 57; y += 1) {
    for (let x = 9; x < 16; x += 1) pixels[y * RELIC_SAMPLE_SIZE + x] = alpha;
  }
  for (let y = 46; y < 55; y += 1) {
    for (let x = 9; x < 51; x += 1) pixels[y * RELIC_SAMPLE_SIZE + x] = alpha;
  }
  return { offeringId, size: RELIC_SAMPLE_SIZE, alpha: pixels };
}

describe("timestamp-confirmed relic ink", () => {
  it("rejects null timestamps and keys confirmed identity by offering and timestamp", () => {
    const kept = relic(1, null);
    expect(isAccreted(kept)).toBe(false);
    expect(isAccreted({ ...kept, accreted_at: Number.NaN })).toBe(false);
    expect(isAccreted({ ...kept, accreted_at: -1 })).toBe(false);

    const accreted = { ...kept, accreted_at: 250 } satisfies AccretedRelic;
    expect(isAccreted(accreted)).toBe(true);
    expect(relicAccretionKey(accreted)).toBe("offering-1\u001f250");
  });

  it("selects only timestamped relics, preserves newest-page order, de-duplicates offerings, and caps fifty", () => {
    const entries = [relic(900, null), ...Array.from({ length: 52 }, (_, index) => relic(index))];
    entries.splice(3, 0, { ...entries[2], id: "duplicate-row" });

    const selected = selectAccretedRelics(entries);
    expect(selected).toHaveLength(RELIC_MEMORY_LIMIT);
    expect(selected.map((entry) => entry.offering_id).slice(0, 4)).toEqual([
      "offering-0",
      "offering-1",
      "offering-2",
      "offering-3",
    ]);
    expect(new Set(selected.map((entry) => entry.offering_id)).size).toBe(RELIC_MEMORY_LIMIT);
    expect(selected.every((entry) => entry.accreted_at !== null)).toBe(true);
  });

  it("places alpha deterministically inside one bounded mask without mutating its inputs", () => {
    const base = new Uint8Array(RELIC_SAMPLE_SIZE * RELIC_SAMPLE_SIZE);
    const ink = sample();
    const baseBefore = base.slice();
    const sampleBefore = ink.alpha.slice();

    const first = mergeRelicAlpha(base, ink, "offering-ink");
    const repeated = mergeRelicAlpha(base, ink, "offering-ink");
    const otherPlacement = mergeRelicAlpha(base, ink, "offering-other");

    expect(first).toEqual(repeated);
    expect(first).not.toEqual(otherPlacement);
    expect(first).toHaveLength(RELIC_SAMPLE_SIZE * RELIC_SAMPLE_SIZE);
    expect(first.some((value) => value > 0)).toBe(true);
    expect(base).toEqual(baseBefore);
    expect(ink.alpha).toEqual(sampleBefore);
  });

  it("saturates bounded addition and folds the same offering only once", () => {
    const empty = new Uint8Array(RELIC_SAMPLE_SIZE * RELIC_SAMPLE_SIZE);
    const ink = sample("duplicate-offering", 96);
    const once = mergeRelicAlpha(empty, ink, ink.offeringId);
    expect(Math.max(...once)).toBe(96);
    expect(foldRelicSamples([ink, ink])).toEqual(foldRelicSamples([ink]));

    const nearlyOpaque = new Uint8Array(RELIC_SAMPLE_SIZE * RELIC_SAMPLE_SIZE).fill(250);
    const saturated = mergeRelicAlpha(nearlyOpaque, sample("bounded-offering", 128), "bounded-offering");
    expect(Math.min(...saturated)).toBeGreaterThanOrEqual(250);
    expect(Math.max(...saturated)).toBe(255);
  });

  it("recomputes the retained fifty so an evicted offering leaves no stale alpha", () => {
    const blank = (offeringId: string): RelicInkSample => ({
      offeringId,
      size: RELIC_SAMPLE_SIZE,
      alpha: new Uint8Array(RELIC_SAMPLE_SIZE * RELIC_SAMPLE_SIZE),
    });
    const retained = [
      ...Array.from({ length: 49 }, (_, index) => blank(`newer-${index}`)),
      sample("oldest"),
    ];
    expect(foldRelicSamples(retained).some((value) => value > 0)).toBe(true);
    expect(foldRelicSamples([blank("newest"), ...retained]).every((value) => value === 0)).toBe(true);
  });

  it("encodes the kept-only public image path without changing the API base", () => {
    expect(relicImageUrl("http://127.0.0.1:8787", "offering/with space?#"))
      .toBe("http://127.0.0.1:8787/api/img/offering%2Fwith%20space%3F%23");
  });
});
