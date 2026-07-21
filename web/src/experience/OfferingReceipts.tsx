import { copy } from "../lib/copy";
import { STAGES } from "./receipts";
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
        <>
          <h2 className="receipt-ledger-label">{copy.yourOfferings.toUpperCase()}</h2>
          <ol data-receipt-list className="flex flex-col gap-1 font-machine text-xs">
            {receipts.map((receipt, index) => {
              const submitted = new Date(receipt.submittedAt).toISOString();
              // The reached point on the mark's fixed path. STAGES is the invariant order; a receipt's
              // stage only ever advances from real public evidence (see reconcileReceipt), so the ladder
              // never claims a step the record has not proven.
              const reached = STAGES.indexOf(receipt.stage);
              return (
                <li
                  key={receipt.offeringId}
                  data-offering-id={receipt.offeringId}
                  data-receipt-stage={receipt.stage}
                  data-latest={index === 0 ? "true" : undefined}
                  className="receipt-row flex min-h-11 min-w-0 flex-col gap-1.5 border-t border-[var(--color-ground-aged)] py-2.5 text-left"
                >
                  <div className="flex items-center justify-between gap-4">
                    <span>{receiptCopy[receipt.stage]}</span>
                    <time dateTime={submitted} className="shrink-0 text-[0.65rem]">
                      {submitted.slice(11, 16)} UTC
                    </time>
                  </div>
                  {/* The whole path, so a Waker can follow a mark from the Threshold into the body. Reached
                      stages in rubric, the current one marked; the rest recede. */}
                  <ol aria-label="the mark's path" className="receipt-path flex flex-wrap items-center gap-x-2 text-[0.6rem]">
                    {STAGES.map((s, i) => (
                      <li
                        key={s}
                        data-reached={i <= reached ? "true" : undefined}
                        aria-current={i === reached ? "step" : undefined}
                        className={
                          i === reached ? "text-rubric-body underline underline-offset-2"
                            : i < reached ? "text-rubric-body"
                            : "text-ink-faded opacity-40"
                        }
                      >
                        {s}
                      </li>
                    ))}
                  </ol>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
