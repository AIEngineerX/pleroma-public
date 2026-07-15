import { useEffect, useRef, useState } from "react";
import type { OfferingReceipt, ReceiptStage } from "./types";

export const receiptCopy: Record<ReceiptStage, string> = {
  pending: "awaiting the Eye",
  witnessed: "witnessed by the Eye",
  judged: "judged by the Keep",
  kept: "kept, awaiting accretion",
  accreted: "carried into the body",
};

interface Props {
  receipts: readonly OfferingReceipt[];
}

export default function OfferingReceipts({ receipts }: Props) {
  const previousStages = useRef<Map<string, ReceiptStage> | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const nextStages = new Map(receipts.map((receipt) => [receipt.offeringId, receipt.stage]));
    const previous = previousStages.current;
    if (previous !== null) {
      const changed = receipts.find((receipt) => previous.get(receipt.offeringId) !== receipt.stage);
      setAnnouncement(changed === undefined ? "" : receiptCopy[changed.stage]);
    }
    previousStages.current = nextStages;
  }, [receipts]);

  return (
    <section data-offering-receipts aria-label="offering receipts" className="w-full max-w-[36rem]">
      {receipts.length > 0 && (
        <ol data-receipt-list className="flex flex-col gap-1 font-machine text-xs text-ink-faded">
          {receipts.map((receipt) => {
            const submitted = new Date(receipt.submittedAt).toISOString();
            return (
              <li
                key={receipt.offeringId}
                data-offering-id={receipt.offeringId}
                data-receipt-stage={receipt.stage}
                className="flex min-h-11 items-center justify-between gap-4 border-t border-[var(--color-ground-aged)] py-2 text-left"
              >
                <span>{receiptCopy[receipt.stage]}</span>
                <time dateTime={submitted} className="shrink-0 text-[0.65rem]">
                  {submitted.slice(11, 16)}
                </time>
              </li>
            );
          })}
        </ol>
      )}
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}
