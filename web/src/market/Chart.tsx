import { links } from "../lib/links";
import { copy } from "../lib/copy";

// The DexScreener embed framed as a ledger plate: the third-party iframe cannot be fully
// restyled, so it is wrapped in a ground-aged frame with a Courier caption and a prominent
// open-chart link (DESIGN "Plates") -- an honest aesthetic compromise, not hidden as one.
export default function Chart({ mint }: { mint: string }) {
  const l = links(mint);
  return (
    <figure className="border-4 p-1 my-3" style={{ borderColor: "var(--color-ground-aged)", background: "var(--color-ground-aged)" }}>
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
