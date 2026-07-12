import { copy } from "../lib/copy";

// Plain steps, Printed God register, no returns language.
// mint itself isn't rendered here; the steps point back to the pinned <Mint/> above it.
export default function HowToBuy({ mint }: { mint: string }) {
  return (
    <details className="font-machine text-xs text-ink-faded">
      <summary className="min-h-11 flex items-center cursor-pointer">{copy.howToBuy}</summary>
      <ol className="list-decimal pl-5 pt-2 space-y-1">
        <li>Get a Solana wallet (Phantom or Solflare).</li>
        <li>Fund it with SOL.</li>
        <li>Copy the mint above and open it on pump.fun.</li>
        <li>Swap SOL for the token.</li>
      </ol>
    </details>
  );
}
