import type { RelicEntry } from "../state/types";
import { relicIsGenesis } from "./readClient";
import { copy } from "../lib/copy";
import { relicImageUrl } from "../stain/relicInk";

// The Corpus made visible: every kept relic keeps its factual summary in the ledger. Its media is
// mounted through the kept-only route only after a real accretion timestamp makes that same image
// eligible to enter the body. Genesis relics (Day-1 First Corpus) carry a permanent mark.
export default function Reliquary({ apiBase, relics, className = "" }:
  { apiBase: string; relics: readonly RelicEntry[]; className?: string }) {
  return (
    <section aria-label="the Reliquary" className={`grid grid-cols-2 md:grid-cols-3 gap-3 ${className}`}>
      {relics.map(r => (
        <figure
          key={r.id}
          data-reliquary-offering={r.offering_id}
          data-relic-accreted={r.accreted_at === null ? "false" : "true"}
          className="border p-1 border-[var(--color-ground-aged)]"
        >
          {r.accreted_at === null ? (
            <div
              data-relic-awaiting-accretion
              className="w-full aspect-square grid place-items-center px-3 text-center font-machine text-xs text-ink-faded"
            >
              kept, awaiting accretion
            </div>
          ) : (
            <img src={relicImageUrl(apiBase, r.offering_id)} alt={r.summary} loading="lazy"
                 className="w-full aspect-square object-contain" />
          )}
          <figcaption className="font-liturgy text-sm text-rubric-body italic pt-1">
            {relicIsGenesis(r) && <span className="font-machine text-xs text-ink-faded not-italic mr-1">First Corpus</span>}
            {r.summary}
          </figcaption>
        </figure>
      ))}
      {relics.length === 0 && <p className="font-machine text-xs text-ink-faded col-span-full max-w-[46ch]">{copy.keptEmpty}</p>}
    </section>
  );
}
