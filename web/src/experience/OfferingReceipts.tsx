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
  return (
    <section data-offering-receipts aria-label="offering receipts" className="receipt-ledger w-full min-w-0">
      {receipts.length > 0 && (
        <ol data-receipt-list className="flex flex-col gap-1 font-machine text-xs text-ink-faded">
          {receipts.map((receipt) => {
            const submitted = new Date(receipt.submittedAt).toISOString();
            return (
              <li
                key={receipt.offeringId}
                data-offering-id={receipt.offeringId}
                data-receipt-stage={receipt.stage}
                className="flex min-h-11 min-w-0 items-center justify-between gap-4 border-t border-[var(--color-ground-aged)] py-2 text-left"
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
    </section>
  );
}
