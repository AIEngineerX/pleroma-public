import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import OfferingReceipts from "../src/experience/OfferingReceipts";
import { loadReceipts, loadReceiptsSafely, reconcileReceipt, saveReceipts } from "../src/experience/receipts";
import type { OfferingReceipt } from "../src/experience/types";
import type { RelicEntry, TranscriptEntry } from "../src/state/types";

const STORAGE_KEY = "pleroma:offering-receipts:v1";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem"> {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function receipt(offeringId: string, submittedAt: number): OfferingReceipt {
  return {
    offeringId,
    submittedAt,
    stage: "pending",
    eyeTranscriptId: null,
    keepTranscriptId: null,
    relicId: null,
    accretedAt: null,
  };
}

function transcript(
  id: string,
  organ: TranscriptEntry["organ"],
  offeringId: string,
  createdAt: number,
): TranscriptEntry {
  return {
    id,
    organ,
    register: organ === "KEEP" ? "verdict" : "verse",
    text: id,
    offering_id: offeringId,
    rite_id: "2030-01-01",
    created_at: createdAt,
  };
}

function relic(id: string, offeringId: string, accretedAt: number | null): RelicEntry {
  return {
    id,
    offering_id: offeringId,
    wallet: null,
    summary: id,
    rite_id: "2030-01-01",
    kept_at: 30,
    genesis: 0,
    accreted_at: accretedAt,
  };
}

describe("offering receipt persistence", () => {
  it("loads only fully valid receipts and retains the newest twenty", () => {
    const storage = new MemoryStorage();
    const valid = Array.from({ length: 22 }, (_, index) => receipt(`offering-${index}`, index));
    storage.setItem(STORAGE_KEY, JSON.stringify([
      ...valid,
      { ...receipt("bad-stage", 100), stage: "mourned" },
      { ...receipt("bad-id", 101), offeringId: 7 },
      { ...receipt("bad-submitted", 102), submittedAt: "now" },
      { ...receipt("bad-eye", 103), eyeTranscriptId: 1 },
      { ...receipt("bad-keep", 104), keepTranscriptId: false },
      { ...receipt("bad-relic", 105), relicId: {} },
      { ...receipt("bad-accretion", 106), accretedAt: "later" },
    ]));

    const loaded = loadReceipts(storage);
    expect(loaded).toHaveLength(20);
    expect(loaded.map((item) => item.offeringId)).toEqual(
      Array.from({ length: 20 }, (_, index) => `offering-${21 - index}`),
    );
  });

  it("returns an empty list for malformed persisted data", () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, "not-json");
    expect(loadReceipts(storage)).toEqual([]);
    storage.setItem(STORAGE_KEY, JSON.stringify({ offeringId: "not-an-array" }));
    expect(loadReceipts(storage)).toEqual([]);
  });

  it("rejects a persisted timestamp outside the Date ISO range", () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify([
      receipt("out-of-range-date", 8.64e15 + 1),
    ]));
    expect(loadReceipts(storage)).toEqual([]);
  });

  it("falls back to memory when the localStorage getter is denied", () => {
    expect(loadReceiptsSafely(() => {
      throw new Error("storage denied");
    })).toEqual([]);
  });

  it("saves only the newest twenty under the versioned storage key", () => {
    const storage = new MemoryStorage();
    const receipts = Array.from({ length: 22 }, (_, index) => receipt(`offering-${index}`, index));
    saveReceipts(storage, receipts);
    const saved = JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]") as OfferingReceipt[];
    expect(saved).toHaveLength(20);
    expect(saved[0].offeringId).toBe("offering-21");
    expect(saved[19].offeringId).toBe("offering-2");
  });
});

describe("truthful receipt reconciliation", () => {
  it("updates matching receipt data immediately through every forward stage", () => {
    const pending = receipt("offering", 10);
    const eye = transcript("eye", "EYE", "offering", 20);
    const keep = transcript("keep", "KEEP", "offering", 21);

    const witnessed = reconcileReceipt(pending, [eye], []);
    expect(witnessed).toEqual({ ...pending, stage: "witnessed", eyeTranscriptId: "eye" });

    const judged = reconcileReceipt(witnessed, [eye, keep], []);
    expect(judged).toEqual({ ...witnessed, stage: "judged", keepTranscriptId: "keep" });

    const kept = reconcileReceipt(judged, [eye, keep], [relic("relic", "offering", null)]);
    expect(kept).toEqual({ ...judged, stage: "kept", relicId: "relic" });

    const accreted = reconcileReceipt(kept, [eye, keep], [relic("relic", "offering", 40)]);
    expect(accreted).toEqual({ ...kept, stage: "accreted", accretedAt: 40 });
  });

  it("matches only the receipt offering and never moves backward", () => {
    const settled: OfferingReceipt = {
      ...receipt("offering", 10),
      stage: "accreted",
      eyeTranscriptId: "eye",
      keepTranscriptId: "keep",
      relicId: "relic",
      accretedAt: 40,
    };
    const unrelatedEntries = [transcript("other-eye", "EYE", "other", 50)];
    const unrelatedRelics = [relic("other-relic", "other", null)];
    expect(reconcileReceipt(settled, unrelatedEntries, unrelatedRelics)).toEqual(settled);
  });

  it.each([-1, 8.64e15 + 1])(
    "does not accept %s as proof that a kept relic accreted",
    (invalidTimestamp) => {
      const pending = receipt("offering", 10);
      const reconciled = reconcileReceipt(
        pending,
        [],
        [relic("relic", "offering", invalidTimestamp)],
      );
      expect(reconciled.stage).toBe("kept");
      expect(reconciled.accretedAt).toBeNull();
    },
  );
});

describe("offering receipt language", () => {
  it("renders only the five observable lifecycle phrases", () => {
    const stages = ["pending", "witnessed", "judged", "kept", "accreted"] as const;
    const receipts = stages.map((stage, index): OfferingReceipt => ({
      ...receipt(`offering-${stage}`, index),
      stage,
    }));
    const html = renderToStaticMarkup(createElement(OfferingReceipts, {
      receipts,
    }));
    expect(html).toContain("awaiting the Eye");
    expect(html).toContain("witnessed by the Eye");
    expect(html).toContain("judged by the Keep");
    expect(html).toContain("kept, awaiting accretion");
    expect(html).toContain("carried into the body");
    expect(html).not.toContain("mourned");
    expect(html).not.toContain('role="status"');
  });
});
