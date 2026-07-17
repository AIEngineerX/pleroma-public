import type { CSSProperties } from "react";
import doctrine from "virtual:public-doctrine";
import { parseCanon } from "../canon/canonParse";
import type { TranscriptEntry } from "../state/types";
import { copy } from "../lib/copy";
import { Glyph } from "../codex/glyphs";
import { focusDelayMs } from "../lib/wordFocus";
import { elapsedLabel, latestByOrganRegister } from "../lib/transcripts";

const canon = parseCanon(doctrine);
const EYE_ARTICLE = canon.articles.find((article) => article.organ === "EYE");

// EYE's home on the Temple: its single most recent verse, refreshing live as new marks are
// witnessed — unlike KEEP/DREAM/PULSE, EYE has no collection or running state of its own, only
// ever "the last thing it saw", which is naturally the most frequently-updating section on the
// page. The verse comes into focus one word at a time (the Door's own focus-in technique, reused
// rather than redefined) — the mechanism matches the metaphor: perceiving is coming into focus.
export default function Eye({ entries, now }: { entries: readonly TranscriptEntry[]; now: number }) {
  const verse = latestByOrganRegister(entries, "EYE", "verse");
  const words = verse === null ? [] : verse.text.split(/\s+/).filter(Boolean);
  return (
    <section aria-label="the eye" className="min-w-0">
      <h2 className="temple-section-label"><Glyph organ="EYE" />{copy.eyeHeading} / ALETHEIA</h2>
      {EYE_ARTICLE && <p className="font-liturgy italic text-rubric-body">{EYE_ARTICLE.line}</p>}
      {verse === null ? (
        <p className="font-machine text-xs text-ink-faded max-w-[44ch]">{copy.eyeEmpty}</p>
      ) : (
        <div key={verse.id}>
          <p className="font-liturgy text-rubric-body leading-relaxed max-w-[46ch]">
            {words.map((word, index) => (
              <span
                key={index}
                className="word-focus-in"
                style={{ "--focus-delay": `${focusDelayMs(index)}ms` } as CSSProperties}
              >
                {word}{index < words.length - 1 ? " " : ""}
              </span>
            ))}
          </p>
          <p className="font-machine text-xs text-ink-faded">{copy.eyeWitnessed} {elapsedLabel(verse.created_at, now)}</p>
        </div>
      )}
    </section>
  );
}
