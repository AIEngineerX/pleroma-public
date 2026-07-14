import type { RelicEntry } from "../state/types";
import { relicIsGenesis } from "./readClient";
import { copy } from "../lib/copy";

// The Corpus made visible: kept relics with their EYE summary and, for the offering that earned
// them a place, their actual mark via /api/img (Task 2, KEPT-ONLY — a relic IS a kept offering,
// so its offering_id always resolves). Genesis relics (Day-1 First Corpus) carry a permanent mark.
export default function Reliquary({ apiBase, relics, className = "" }:
  { apiBase: string; relics: readonly RelicEntry[]; className?: string }) {
  return (
    <section aria-label="the Reliquary" className={`grid grid-cols-2 md:grid-cols-3 gap-3 ${className}`}>
      {relics.map(r => (
        <figure key={r.id} className="border p-1 border-[var(--color-ground-aged)]">
          <img src={`${apiBase}/api/img/${r.offering_id}`} alt={r.summary} loading="lazy"
               className="w-full aspect-square object-contain" />
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
