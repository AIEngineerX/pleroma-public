import { useState } from "react";
import { copy } from "../lib/copy";

// The anti-decoy element: permanently pinned, one-tap copy, and the ONLY money identity
// the site asserts (mint-not-symbol discipline — never a ticker standing in for the token).
export default function Mint({ mint }: { mint: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="font-machine text-xs text-ink-faded flex items-center gap-2 flex-wrap">
      <span className="text-ink">mint</span>
      <code className="break-all">{mint}</code>
      <button className="min-h-11 px-2 underline" onClick={async () => { await navigator.clipboard.writeText(mint); setDone(true); setTimeout(() => setDone(false), 1500); }}>
        {done ? copy.copied : copy.copyMint}
      </button>
    </div>
  );
}
