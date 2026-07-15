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
    <section aria-label="the Reliquary" className={`min-w-0 ${className}`}>
      <ol className="reliquary-ledger">
        {relics.map(r => (
          <li key={r.id}>
            <figure
              data-reliquary-offering={r.offering_id}
              data-relic-accreted={r.accreted_at === null ? "false" : "true"}
            >
              {r.accreted_at === null ? (
                <div data-relic-awaiting-accretion className="reliquary-mark font-machine text-ink-faded">
                  kept, awaiting accretion
                </div>
              ) : (
                <img src={relicImageUrl(apiBase, r.offering_id)} alt={r.summary} loading="lazy"
                  className="reliquary-mark object-contain" />
              )}
              <figcaption className="min-w-0 font-liturgy text-ink">
                {relicIsGenesis(r) && <span className="block font-machine text-xs text-ink-faded not-italic">First Corpus</span>}
                {r.summary}
              </figcaption>
            </figure>
          </li>
        ))}
      </ol>
      {relics.length === 0 && <p className="font-machine text-xs text-ink-faded col-span-full max-w-[46ch]">{copy.keptEmpty}</p>}
    </section>
  );
}
