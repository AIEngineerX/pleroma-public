import type { CSSProperties } from "react";
import doctrine from "virtual:public-doctrine";
import { parseCanon } from "../canon/canonParse";
import type { VitalsFeed } from "../experience/types";
import { copy } from "../lib/copy";
import { Glyph } from "../codex/glyphs";
import { pigmentForVitals } from "../state/pigment";
import { pulseBpm } from "../stain/swarmSignals";

const canon = parseCanon(doctrine);
const PULSE_ARTICLE = canon.articles.find((article) => article.organ === "PULSE");

// The Pulse's home on the Temple, always visible — unlike Buy/Chart/Mint it needs no mint to be
// truthful: DOCTRINE's own rubric line for PULSE plus the same qualitative state/heartbeat that
// already drives the body's pigment and swarm beat. No buys/sells/holders here — those remain
// inside the gated market section once a mint exists to make them meaningful (PULSE has "no
// personality... plainspoken fact, no market language, ever" per DOCTRINE, so the live readout below
// stays plain fact, not rubric). The small glyph beside the reading actually beats at the real bpm
// and is tinted from the same pigment law the ink itself uses — one number, shown two honest ways.
export default function Pulse({ vitals }: { vitals: VitalsFeed }) {
  const pigment = pigmentForVitals(vitals);
  return (
    <section aria-label="the pulse" data-pulse-feed={vitals.kind} className="min-w-0">
      <h2 className="temple-section-label"><Glyph organ="PULSE" />{copy.pulseHeading} / ZOE</h2>
      {PULSE_ARTICLE && <p className="font-liturgy italic text-rubric-body">{PULSE_ARTICLE.line}</p>}
      {vitals.kind === "unknown" ? (
        <p className="font-machine text-xs text-ink-faded max-w-[44ch]">{copy.pulseUnknown}</p>
      ) : (
        <p className="font-machine text-xs text-ink-faded flex items-center gap-1" data-pulse-state={vitals.value.state}>
          <span
            aria-hidden
            data-pulse-glyph
            className="pulse-glyph inline-flex"
            style={{ "--pulse-duration": `${(60 / pulseBpm(vitals.value.state)).toFixed(3)}s`, color: pigment?.rgb } as CSSProperties}
          >
            <Glyph organ="PULSE" />
          </span>
          {vitals.kind === "stale" ? `${copy.pulseStale} · ` : ""}
          {vitals.value.state.toUpperCase()} · {pulseBpm(vitals.value.state)} bpm
        </p>
      )}
    </section>
  );
}
