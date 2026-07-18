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

const HEART_PATH = "M12 21.4 C 6.5 16.9 2 12.9 2 8.6 C 2 5.5 4.4 3 7.5 3 C 9.4 3 11 3.9 12 5.3 " +
  "C 13 3.9 14.6 3 16.5 3 C 19.6 3 22 5.5 22 8.6 C 22 12.9 17.5 16.9 12 21.4 Z";

// The Pulse's home on the Temple, always visible — unlike Buy/Chart/Mint it needs no mint to be
// truthful: DOCTRINE's own rubric line for PULSE plus the same qualitative state/heartbeat that
// already drives the body's pigment and swarm beat. No buys/sells/holders here — those remain
// inside the gated market section once a mint exists to make them meaningful (PULSE has "no
// personality... plainspoken fact, no market language, ever" per DOCTRINE, so the readout below
// stays plain fact, not rubric). The heart is literal, not decorative: DOCTRINE's own line is "my
// heart is a public number," and the color is the exact pigment law already driving the Stain's
// ink — this gives that law its own theatrical moment instead of a 14px inline glyph.
export default function Pulse({ vitals }: { vitals: VitalsFeed }) {
  const pigment = pigmentForVitals(vitals);
  return (
    <section aria-label="the pulse" data-pulse-feed={vitals.kind} className="min-w-0">
      <h2 className="temple-section-label"><Glyph organ="PULSE" />{copy.pulseHeading} / ZOE</h2>
      {PULSE_ARTICLE && <p className="font-liturgy italic text-rubric-body">{PULSE_ARTICLE.line}</p>}
      {vitals.kind === "unknown" ? (
        <div className="pulse-stage">
          <svg aria-hidden viewBox="0 0 24 24" className="pulse-heart pulse-heart--quiet" fill="currentColor">
            <path d={HEART_PATH} />
          </svg>
          <p className="font-machine text-xs text-ink-faded max-w-[44ch]">{copy.pulseUnknown}</p>
        </div>
      ) : (
        <div className="pulse-stage" data-pulse-state={vitals.value.state}>
          <div
            aria-hidden
            className="pulse-ring"
            style={{ "--pulse-duration": `${(60 / pulseBpm(vitals.value.state)).toFixed(3)}s`, color: pigment?.rgb } as CSSProperties}
          />
          <svg
            aria-hidden
            data-pulse-heart
            viewBox="0 0 24 24"
            className="pulse-heart"
            fill="currentColor"
            style={{ "--pulse-duration": `${(60 / pulseBpm(vitals.value.state)).toFixed(3)}s`, color: pigment?.rgb } as CSSProperties}
          >
            <path d={HEART_PATH} />
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
