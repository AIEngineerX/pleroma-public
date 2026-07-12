import { copy } from "../lib/copy";

// ALWAYS visible, dormant or live (integrity invariant, CLAUDE.md "Integrity invariants").
export default function Disclaimer() {
  return <p role="note" className="font-machine text-xs text-ink-faded max-w-[70ch] mx-auto text-center py-3">{copy.disclaimer}</p>;
}
