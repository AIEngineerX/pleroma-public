import type { RelicEntry, TranscriptEntry } from "../state/types";
import type { OfferingReceipt, ReceiptStage } from "./types";

const STORAGE_KEY = "pleroma:offering-receipts:v1";
const MAX_RECEIPTS = 20;
const MAX_DATE_TIMESTAMP = 8.64e15;
const STAGES: readonly ReceiptStage[] = ["pending", "witnessed", "judged", "kept", "accreted"];

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= 0
    && value <= MAX_DATE_TIMESTAMP;
}

function isReceipt(value: unknown): value is OfferingReceipt {
  if (typeof value !== "object" || value === null) return false;
  const receipt = value as Record<string, unknown>;
  return typeof receipt.offeringId === "string"
    && receipt.offeringId.length > 0
    && isTimestamp(receipt.submittedAt)
    && typeof receipt.stage === "string"
    && STAGES.includes(receipt.stage as ReceiptStage)
    && isNullableString(receipt.eyeTranscriptId)
    && isNullableString(receipt.keepTranscriptId)
    && isNullableString(receipt.relicId)
    && (receipt.accretedAt === null || isTimestamp(receipt.accretedAt));
}

function newestTwenty(values: readonly OfferingReceipt[]): OfferingReceipt[] {
  return [...values]
    .sort((a, b) => b.submittedAt - a.submittedAt || b.offeringId.localeCompare(a.offeringId))
    .slice(0, MAX_RECEIPTS);
}

export function loadReceipts(storage: Pick<Storage, "getItem">): OfferingReceipt[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return newestTwenty(parsed.filter(isReceipt));
  } catch {
    return [];
  }
}

export function loadReceiptsSafely(getStorage: () => Pick<Storage, "getItem">): OfferingReceipt[] {
  try {
    return loadReceipts(getStorage());
  } catch {
    return [];
  }
}

export function saveReceipts(
  storage: Pick<Storage, "setItem">,
  receipts: readonly OfferingReceipt[],
): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(newestTwenty(receipts.filter(isReceipt))));
}

function laterStage(current: ReceiptStage, evidence: ReceiptStage): ReceiptStage {
  return STAGES.indexOf(evidence) > STAGES.indexOf(current) ? evidence : current;
}

export function reconcileReceipt(
  receipt: OfferingReceipt,
  entries: readonly TranscriptEntry[],
  relics: readonly RelicEntry[],
): OfferingReceipt {
  const eye = entries.find((entry) => entry.offering_id === receipt.offeringId && entry.organ === "EYE");
  const keep = entries.find((entry) => entry.offering_id === receipt.offeringId && entry.organ === "KEEP");
  const relic = relics.find((entry) => entry.offering_id === receipt.offeringId);

  let stage = receipt.stage;
  if (eye) stage = laterStage(stage, "witnessed");
  if (keep) stage = laterStage(stage, "judged");
  if (relic) stage = laterStage(stage, "kept");
  if (relic?.accreted_at !== null && relic?.accreted_at !== undefined) stage = laterStage(stage, "accreted");

  return {
    ...receipt,
    stage,
    eyeTranscriptId: receipt.eyeTranscriptId ?? eye?.id ?? null,
    keepTranscriptId: receipt.keepTranscriptId ?? keep?.id ?? null,
    relicId: receipt.relicId ?? relic?.id ?? null,
    accretedAt: receipt.accretedAt ?? relic?.accreted_at ?? null,
  };
}
