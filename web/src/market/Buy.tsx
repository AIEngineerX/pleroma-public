import { links } from "../lib/links";
import { copy } from "../lib/copy";

export default function Buy({ mint }: { mint: string }) {
  return (
    <a href={links(mint).pump!} target="_blank" rel="noopener noreferrer"
       className="min-h-11 inline-flex items-center px-6 font-liturgy text-lg border" style={{ borderColor: "var(--color-ink)" }}>
      {copy.buy}
    </a>
  );
}
