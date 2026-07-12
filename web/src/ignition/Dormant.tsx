import { formatCountdown } from "../countdown";
import type { TempleState } from "../state/types";
import { copy } from "../lib/copy";

// The dormant product (PLANNING "Day-1 ignition"): "it has no heart yet" and a Courier countdown
// to the First Rite. Nests inside Temple's existing "the page" section (Emblem/heading/Stain stay
// there) rather than owning the whole screen, so the Reliquary, offering surface, and margin
// tallies -- which work before the token launches -- are never hidden by this component.
export default function Dormant({ state, now }: { state: TempleState | null; now: number }) {
  return (
    <>
      <p className="font-liturgy italic text-ink-faded">{copy.noHeart}</p>
      {state?.countdown_to
        ? <p className="font-machine text-xs text-ink-faded">FIRST RITE {formatCountdown(now, state.countdown_to)}</p>
        : <p className="font-machine text-xs text-ink-faded">FIRST RITE NOT YET SCHEDULED</p>}
    </>
  );
}
