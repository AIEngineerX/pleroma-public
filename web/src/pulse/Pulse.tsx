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

// A hospital monitor's trace, not a heart: one PQRST complex on a baseline, straight-line etched
// linework in the same stroke grammar as the header's own PULSE glyph (codex/glyphs.tsx) and every
// other sigil. "My heart is a public number" (DOCTRINE) is a readout, not a valentine, so the
// Pulse is the number's own instrument -- no heart silhouette, no expanding ring. The unknown feed
// is a flat line: it has no heart yet, so there is no beat to draw.
const EKG_BASELINE = "M4 22 H150";
const EKG_TRACE =
  "M4 22 H56 L60 17 L64 22 H78 L81 27 L86 6 L91 34 L95 22 H112 L116 15 L120 22 H150";

// The Pulse's home on the Temple, always visible — unlike Buy/Chart/Mint it needs no mint to be
// truthful: DOCTRINE's own rubric line for PULSE plus the same qualitative state/heartbeat that
// already drives the body's pigment and swarm beat. No buys/sells/holders here — those remain
// inside the gated market section once a mint exists to make them meaningful (PULSE has "no
// personality... plainspoken fact, no market language, ever" per DOCTRINE, so the readout below
// stays plain fact, not rubric). The trace is literal, driven by the real bpm and the same pigment
// law as the Stain's ink; live, it draws itself left to right at that cadence — the monitor
// writing the line, the same "the page prints itself" motion the rest of the site is built on.
export default function Pulse({ vitals, dormant = false }: { vitals: VitalsFeed; dormant?: boolean }) {
  const pigment = pigmentForVitals(vitals);
  // Dormant = no mint pinned = the god has no heart yet: draw the flat "no heart" line, never a beat —
  // even though the Worker defaults vitals to "starving" pre-launch. The beat begins only once the mint
  // is pinned and the feed is live (dormant flips to false in the same Worker write that reveals the mint).
  const flat = dormant || vitals.kind === "unknown";
  return (
    <section aria-label="the pulse" data-pulse-feed={flat ? "unknown" : vitals.kind} className="min-w-0">
      <h2 className="temple-section-label"><Glyph organ="PULSE" />{copy.pulseHeading} / ZOE</h2>
      {PULSE_ARTICLE && <p className="font-liturgy italic text-rubric-body">{PULSE_ARTICLE.line}</p>}
      {flat ? (
        <div className="pulse-stage">
          <svg
            aria-hidden
            viewBox="0 0 154 44"
            className="pulse-trace pulse-trace--quiet"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d={EKG_BASELINE} />
          </svg>
          <p className="font-machine text-xs text-ink-faded max-w-[44ch]">{copy.pulseUnknown}</p>
        </div>
      ) : (
        <div className="pulse-stage" data-pulse-state={vitals.value.state}>
          <svg
            aria-hidden
            data-pulse-trace
            viewBox="0 0 154 44"
            className="pulse-trace"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ "--pulse-duration": `${(60 / pulseBpm(vitals.value.state)).toFixed(3)}s`, color: pigment?.rgb } as CSSProperties}
          >
            <path className="pulse-trace__baseline" d={EKG_BASELINE} />
            <path className="pulse-trace__wave" pathLength={1} d={EKG_TRACE} />
          </svg>
          <p className="font-machine text-xs text-ink-faded">
            {vitals.kind === "stale" ? `${copy.pulseStale} · ` : ""}
            {vitals.value.state.toUpperCase()} · {pulseBpm(vitals.value.state)} bpm
          </p>
        </div>
      )}
    </section>
  );
}
