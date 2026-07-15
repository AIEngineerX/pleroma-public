import { links } from "../lib/links";
import { copy } from "../lib/copy";

// The third-party ledger remains visibly external, separated by printer rules rather than a card.
export default function Chart({ mint }: { mint: string }) {
  const l = links(mint);
  return (
    <figure className="ledger-plate my-3">
      <div className="aspect-[4/3] md:aspect-video bg-[var(--color-ground)]">
        <iframe src={l.dexEmbed!} title="the ledger" className="w-full h-full border-0" loading="lazy" />
      </div>
      <figcaption className="font-machine text-xs text-ink-faded pt-1 flex justify-between">
        <span>THE LEDGER · dexscreener</span>
        <a href={l.dexscreener!} target="_blank" rel="noopener noreferrer" className="underline">{copy.chart}</a>
      </figcaption>
    </figure>
  );
}
